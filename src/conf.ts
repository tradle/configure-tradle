import path = require('path')
import fs = require('fs')
import os = require('os')
import yn = require('yn')
import tmp = require('tmp')
import _ = require('lodash')
import co = require('co')
import promisify = require('pify')
import promiseRetry from 'promise-retry'
// import YAML = require('js-yaml')
import AWS = require('aws-sdk')
import _mkdirp = require('mkdirp')
import shelljs = require('shelljs')
import Listr = require('listr')
import Errors from '@tradle/errors'
import ModelsPack = require('@tradle/models-pack')
import {
  init as promptInit,
  fn as promptFn,
  confirm,
} from './prompts'
import { update } from './update'
import { AWSClients,
  ConfOpts,
  NodeFlags,
  UpdateOpts,
  InvokeOpts,
  WaitStackOpts,
  VersionInfo,
  GetUpdateInfoResp,
  ApplyUpdateOpts,
} from './types'
import { Errors as CustomErrors } from './errors'
import * as validate from './validate'
import * as utils from './utils'
import { logger, colors } from './logger'

tmp.setGracefulCleanup() // delete tmp files even on uncaught exception

const mkdirp = promisify(_mkdirp)
const pfs = promisify(fs)
const { prettify, isValidProjectPath, toEnvFile, confirmOrAbort } = utils
const AWS_CONF_PATH = `${os.homedir()}/.aws/config`
const getFileNameForItem = item => `${item.id}.json`
const read:any = file => fs.readFileSync(file, { encoding: 'utf8' })
const maybeRead = file => {
  if (fs.existsSync(file)) return read(file)
}

const readJSON = file => JSON.parse(read(file))
const maybeReadJSON = file => {
  const result = maybeRead(file)
  if (result) return JSON.parse(result)
}

const write = (file, data) => fs.writeFileSync(file, prettify(data))
const pwrite = (file, data) => pfs.writeFile(file, prettify(data))
const exists = file => fs.existsSync(file)
const getLongFunctionName = ({ stackName, functionName }) => {
  // in case it's already expanded
  if (functionName.lastIndexOf(stackName) === 0) return functionName

  return `${stackName}-${functionName}`
}

const readDirOfJSONs = dir => {
  return fs.readdirSync(dir)
    .map(file => require(path.resolve(dir, file)))
}

const normalizeError = err => {
  if (err instanceof Error) return err

  const { name, message='unspecified' } = err
  let normalized
  if (name && name in global) {
    const ctor = global[name]
    try {
      normalized = new ctor(name)
    } catch (err) {}
  }

  if (!normalized) {
    normalized = new Error(message)
  }

  _.extend(normalized, err)
  return normalized
  // return new Error(JSON.stringify(err))
}

const DEPLOYABLES = [
  'bot',
  'style',
  'models',
  'modelsPack',
  'terms'
]

const getDeployables = opts => _.pick(opts, DEPLOYABLES)
const getDeployablesKeys = opts => Object.keys(getDeployables(opts))
const DEPLOY_ALL_OPTS = DEPLOYABLES.reduce((obj, prop) => {
  obj[prop] = true
  return obj
}, {})

const getOptsOnly = opts => _.omit(opts, 'args')
const normalizeDeployOpts = (opts, command='deploy') => {
  if (opts.args.length) {
    throw new CustomErrors.InvalidInput(`unknown arguments: ${opts.args.join(' ')}`)
  }

  const all = opts.all || !_.size(getDeployables(opts))
  if (all) {
    return _.extend({}, DEPLOY_ALL_OPTS, opts)
  }

  if (!_.size(getDeployables(opts))) {
    throw new CustomErrors.InvalidInput(`you didn't indicate anything to ${command}!`)
  }

  return opts
}

const functions = {
  setconf: 'setconf',
  cli: 'cli',
  importDataUtils: 'import_data_utils'
}

const paths = {
  conf: './conf',
  bot: './conf/bot.json',
  style: './conf/style.json',
  terms: './conf/terms-and-conditions.md',
  models: './models',
  lenses: './lenses'
}

read.bot = () => maybeReadJSON(paths.bot)
read.style = () => maybeReadJSON(paths.style)
read.models = () => readDirOfJSONs(paths.models)
read.lenses = () => readDirOfJSONs(paths.lenses)
read.terms = () => maybeRead(paths.terms)

const createImportDataUtilsMethod = ({
  method,
  props=[],
  required
}: {
  method: string
  props: string[]
  required?: string[]
}) => async (data) => {
  data = _.pick(data, props)
  ;(required || props).forEach(prop => {
    if (!(prop in data)) throw new CustomErrors.InvalidInput(`expected "${prop}"`)
  })

  return await this.invokeAndReturn({
    functionName: functions.importDataUtils,
    arg: { method, data }
  })
}

type AWSConfigOpts = {
  region?: string
  profile?: string
}

export class Conf {
  private client: AWSClients
  private region: string
  private profile: string
  private stackName: string
  private stackId: string
  private namespace: string
  private local?: boolean
  private remote?: boolean
  private project?: string
  private nodeFlags?: NodeFlags

  constructor (opts: ConfOpts) {
    const { region, profile, namespace, stackId, stackName, local, remote, project, nodeFlags={} } = opts

    if (local && remote) {
      throw new CustomErrors.InvalidInput('expected "local" or "remote" but not both')
    }

    if (local) {
      if (!project) {
        throw new CustomErrors.InvalidInput('expected "project", the path to your local serverless project')
      }

      if (!isValidProjectPath(project)) {
        throw new CustomErrors.InvalidInput('expected "project" to point to serverless project dir')
      }
    }

    utils.normalizeNodeFlags(nodeFlags)
    if (remote && !_.isEmpty(nodeFlags)) {
      throw new CustomErrors.InvalidInput('node debugging flags are only supported for local operations')
    }

    this.nodeFlags = nodeFlags
    this.region = region
    this.namespace = namespace
    this.profile = profile
    this.stackName = stackName
    this.stackId = stackId
    this.local = local
    this.remote = remote || !project
    this.project = project

    let client
    Object.defineProperty(this, 'client', {
      set (value) {
        client = value
      },
      get () {
        if (!client) {
          client = this._getAWSClient()
        }

        return client
      }
    })
  }

  public deploy = async (opts) => {
    const items = this.getDeployItems(opts)
    logger.info('deploying: ', getDeployablesKeys(items).join(', '))
    if (opts.dryRun) return logger.info('dry run, not executing')

    const { error, result } = await this.invoke({
      functionName: functions.setconf,
      arg: items
    })

    if (error) throw error

    return result
  }

  public invoke = async (opts) => {
    let { functionName, arg, local=this.local } = opts
    if (!functionName) functionName = await promptFn(this, 'which function?')

    let result
    try {
      const promise = local ? this._invokeLocal(opts) : this._invoke(opts)
      result = await promise
    } catch (error) {
      return { error }
    }

    return { result }
  }

  public invokeAndReturn = async (opts: InvokeOpts) => {
    const { error, result } = await this.invoke(opts)
    if (error) throw error
    return result
  }

  public getLongFunctionName = (functionName: string) => getLongFunctionName({
    stackName: this.stackName,
    functionName
  })

  public getDeployItems = (opts:any) => {
    opts = normalizeDeployOpts(opts)
    const parts:any = {}
    if (opts.style) {
      parts.style = read.style()
    }

    if (opts.terms) {
      parts.terms = read.terms()
    }

    if (opts.models) {
      const models = read.models()
      const lenses = read.lenses()
      if (models.length || lenses.length) {
        parts.modelsPack = utils.pack({ models, lenses, namespace: this.namespace })
      }
    }

    if (opts.bot) {
      parts.bot = read.bot()
    }

    return parts
  }

  public load = async (opts:any={}) => {
    opts = normalizeDeployOpts(opts, 'load')
    logger.info('loading: ', getDeployablesKeys(opts).join(', '))
    if (opts.dryRun) return logger.info('dry run, not executing')

    const result = await this.exec({
      args: ['getconf --conf']
    })

    if (opts.style && result.style) {
      logger.debug('loaded remote style')
      write(paths.style, result.style)
    }

    if (opts.bot && result.bot) {
      logger.debug('loaded remote bot conf')
      write(paths.bot, result.bot)
    }

    if (opts.terms && result.termsAndConditions) {
      logger.debug('loaded remote terms and conditions')
      write(paths.terms, result.termsAndConditions.value)
    }

    if (opts.models && result.modelsPack) {
      logger.debug('loaded remote models and lenses')
      this.writeModels(result.modelsPack)
    }
  }

  public writeModels = async (modelsPack) => {
    await ['models', 'lenses'].map(async (prop) => {
      const arr = modelsPack[prop]
      if (!arr) return

      await this.writeToFiles({
        dir: paths[prop],
        arr,
        name: getFileNameForItem
      })
    })
  }

  public writeToFiles = async ({ dir, name, arr }) => {
    await mkdirp(dir)
    await Promise.all(arr.map(item => {
      return pwrite(path.join(dir, name(item)), item)
    }))
  }

  public validate = async (opts) => {
    const items = this.getDeployItems(opts)
    _.each(items, (value, key) => {
      if (!validate[key]) {
        logger.info(`validation for ${key} will be done in cloud-side on deploy`)
        return
      }

      if (typeof value !== 'undefined') {
        logger.debug(`validating: ${key}`)
        validate[key](value)
      }
    })
  }

  public exec = async (opts) => {
    const res = await this.invoke({
      functionName: functions.cli,
      arg: opts.args[0],
      noWarning: opts.noWarning
    })

    // invoke() returns { error, result }
    let { error, result } = res
    if (error) throw normalizeError(error)

    // cli lambda returns { error, result }
    ;({ error, result } = result)
    if (error) throw normalizeError(error)

    return result
  }

  public init = async (opts={}) => {
    const {
      haveLocal,
      haveRemote,
      overwriteEnv,
      region,
      awsProfile,
      stack={},
      projectPath
    } = await promptInit(this)

    if (overwriteEnv === false) return

    if (!(haveLocal || haveRemote)) {
      logger.warn("Aborting. Re-run `tradleconf init` when you've either deployed a MyCloud, or have a local development environment, or both")
      return
    }

    this.remote = haveRemote
    this.region = region
    this.profile = awsProfile
    this.stackName = stack.name
    this.stackId = stack.id
    // force reload aws profile
    this.client = null

    const env:any = utils.pickNonNull({
      region,
      awsProfile,
      stackName: this.stackName,
      stackId: this.stackId,
      project: projectPath && path.resolve(process.cwd(), projectPath)
    })

    const saveEnv = async () => {
      write('.env', toEnvFile(env))

      // logger.info('wrote .env')
      await Promise.all([
        paths.models,
        paths.lenses,
        paths.conf
      ].map(dir => mkdirp(dir)))
    }

    const saveEnvTask = {
      title: 'saving .env',
      task: saveEnv
    }

    if (haveRemote) {
      const tasks = new Listr([
        {
          title: 'loading deployment info',
          task: async (ctx) => {
            ctx.info = await this.getEndpointInfo()
          }
        },
        {
          title: 'initializing local conf',
          task: async (ctx) => {
            env.apiBaseUrl = ctx.info.apiBaseUrl
            env.namespace = ctx.info.org.domain
              .split('.')
              .reverse()
              .join('.')
          }
        },
        saveEnvTask
      ])

      await tasks.run()
    } else {
      await saveEnv()
    }

    logger.success('initialization complete!')
    // logger.info('Would you like to load your currently deployed configuration?')
    // const willLoad = await prompt('Note: this may overwrite your local files in ./conf, ./models and ./lenses (y/n)')
    // if (!yn(willLoad)) return
  }

  private _getAWSClient = (opts:AWSConfigOpts={}) => {
    const {
      profile=this.profile || process.env.awsProfile,
      region=this.region
    } = opts

    if (region) {
      AWS.config.update({ region })
    }

    if (profile) {
      AWS.config.update({
        credentials: new AWS.SharedIniFileCredentials({ profile })
      })
    }

    const s3 = new AWS.S3()
    const cloudformation = new AWS.CloudFormation()
    const lambda = new AWS.Lambda()
    // const dynamodb = new AWS.DynamoDB()
    // const docClient = new AWS.DynamoDB.DocClient()
    return {
      s3,
      cloudformation,
      lambda,
      // dynamodb,
      // docClient
    }
  }

  public getStacks = async (opts={}) => {
    const client = this._getAWSClient(opts)
    return await utils.listStacks(client)
  }

  public waitForStackUpdate = async (opts?:WaitStackOpts) => {
    const { stackName=this.stackName } = opts || {}
    const client = this._getAWSClient()
    await utils.awaitStackUpdate(client, stackName)
  }

  public waitForStackDelete = async (opts?:WaitStackOpts) => {
    const { stackName=this.stackName } = opts || {}
    const client = this._getAWSClient()
    await utils.awaitStackDelete(this.client, stackName)
  }

  public createDataBundle = async ({ path }) => {
    let bundle
    try {
      bundle = readJSON(path)
    } catch (err) {
      throw new CustomErrors.InvalidInput('expected "path" to bundle')
    }

    return await this.invokeAndReturn({
      functionName: functions.importDataUtils,
      arg: {
        method: 'createbundle',
        data: bundle
      }
    })
  }

  public createDataClaim = createImportDataUtilsMethod({
    method: 'createclaim',
    props: ['key', 'claimType']
  })

  public listDataClaims = createImportDataUtilsMethod({
    method: 'listclaims',
    props: ['key']
  })

  public getDataBundle = createImportDataUtilsMethod({
    method: 'getbundle',
    props: ['key', 'claimId'],
    required: []
  })

  private _ensureRemote = (strict=true) => {
    if (this.local) {
      throw new CustomErrors.InvalidInput('not supported for local dev env')
    }

    if (strict && !this.remote) {
      throw new CustomErrors.InvalidInput(`please specify -r, --remote or -l, --local to indicate whether you're targeting your remote or local deployment`)
    }
  }

  public destroy = async (opts) => {
    this._ensureStackNameKnown()
    this._ensureRemote()
    const { stackName } = this
    await confirmOrAbort(`DESTROY REMOTE MYCLOUD ${stackName}?? There's no undo for this one!`)
    await confirmOrAbort(`Are you REALLY REALLY sure you want to MURDER ${stackName}?`)
    const buckets = await utils.listStackBucketIds(this.client, stackName)
    buckets.forEach(id => logger.info(id))
    await confirmOrAbort('Delete these buckets?')
    for (const id of buckets) {
      logger.info(`emptying and deleting: ${id}`)
      await utils.destroyBucket(this.client, id)
    }

    logger.info('Note: it may take a few minutes for your stack to be deleted')
    await new Listr([
      {
        title: 'disabling termination protection',
        task: async (ctx) => {
          await utils.disableStackTerminationProtection(this.client, stackName)
        }
      },
      {
        title: 'deleting stack',
        task: async (ctx) => {
          await utils.deleteStack(this.client, stackName)
          await utils.wait(5000)
          await this.waitForStackDelete()
        }
      },
    ]).run()
  }

  public getApiBaseUrl = async () => {
    if (this.local) {
      return null
    }

    return utils.getApiBaseUrl(this.client, this.stackName)
  }

  public info = async () => {
    this._ensureStackNameKnown()
    return await this._info()
  }

  public _info = async () => {
    const getLinks = this.invokeAndReturn({
      functionName: 'cli',
      arg: 'links',
      noWarning: true
    })

    const getInfo = this.getEndpointInfo()
    const [links, info] = await Promise.all([getLinks, getInfo])
    return Object.assign(
      { links: links.result },
      _.pick(info, ['version', 'chainKey', 'apiBaseUrl'])
    )
  }

  public getEndpointInfo = async () => {
    const getApiBaseUrl = this.getApiBaseUrl()
    const info = await this.invokeAndReturn({
      functionName: 'info',
      arg: {},
      noWarning: true
    })

    if (info.isBase64Encoded) {
      info.body = new Buffer(info.body, 'base64')
    }

    const endpoint = JSON.parse(info.body)
    endpoint.apiBaseUrl = await getApiBaseUrl
    return endpoint
  }

  public getFunctions = async () => {
    this._ensureStackNameKnown()
    const { client, stackName } = this
    const functions = await utils.listStackFunctionIds(client, stackName)
    return functions.map(f => f.slice(stackName.length + 1))
  }

  public tail = async (opts:any={}) => {
    return this.log({ watch: true, ...opts })
  }

  public log = async (opts:any={}) => {
    this._ensureStackNameKnown()
    this._ensureRemote(false)

    utils.checkCommandInPath('awslogs')

    const { client, stackName } = this
    let functionName = opts.args[0]
    if (!functionName) {
      functionName = await promptFn(this, 'which one do you want to log?')
    }

    const longName = getLongFunctionName({ stackName, functionName })
    const logOpts = getOptsOnly(opts)
    if (this.profile) logOpts.profile = this.profile
    if (this.region) logOpts['aws-region'] = this.region

    const passThrough = Object.keys(logOpts)
    const logOptsStr = passThrough
      .map(opt => {
        const key = utils.splitCamelCase(opt)
          .join('-')
          .toLowerCase()

        const val = logOpts[opt]
        if (val === true) {
          return `--${key}`
        }

        return `--${key}=${val}`
      })
      .join(' ')

    const cmd = `awslogs get /aws/lambda/${longName} ${logOptsStr}`
    logger.info(cmd)
    shelljs.exec(cmd)
  }

  public balance = async () => {
    return await this.exec({
      args: ['balance']
    })
  }

  public disable = async () => {
    return await this.exec({
      args: ['setenvvar --key DISABLED --value 1']
    })
  }

  public enable = async () => {
    return await this.exec({
      args: ['setenvvar --key DISABLED']
    })
  }

  public query = async (query: string) => {
    const queryString = JSON.stringify(query.replace(/[\s]/g, ' '))
    return await this.exec({
      args: [`graphql --query ${queryString}`]
    })
  }

  public getMyIdentity = async () => {
    return await this.invokeAndReturn({
      functionName: 'cli',
      arg: 'identity',
      noWarning: true
    })
  }

  public getMyPermalink = async () => {
    const identity = await this.getMyIdentity()
    return identity._permalink
  }

  public getCurrentVersion = async ():Promise<VersionInfo> => {
    const versions = await this.exec({
      args: ['listmyversions --limit 1'],
      noWarning: true
    })

    return versions[0]
    // const { version } = await this.info()
    // return version
  }

  public listUpdates = async ({ provider }: {
    provider?: string
  }={}):Promise<VersionInfo[]> => {
    let command = 'listupdates'
    if (provider) command = `${command} --provider ${provider}`

    return await this.exec({
      args: [command],
      noWarning: true
    })
  }

  public listPreviousVersions = async ():Promise<VersionInfo[]> => {
    return await this.exec({
      args: [`listmyversions`],
      noWarning: true
    })
  }

  public requestUpdate = async ({ tag, provider }) => {
    if (!tag) throw new CustomErrors.InvalidInput('expected string "tag"')

    this._ensureRemote(false)
    let command = `getupdate --tag "${tag}"`
    if (provider) command = `${command} --provider ${provider}`

    await this.exec({
      args: [command],
      noWarning: true
    })
  }

  public getUpdateInfo = async ({ tag }):Promise<GetUpdateInfoResp> => {
    this._ensureRemote(false)
    const result = await this.exec({
      args: [`getupdateinfo --tag "${tag}"`],
      noWarning: true
    })

    if (!result.update) {
      throw new CustomErrors.NotFound(`not found: update with version: ${tag}`)
    }

    return result
  }

  public update = async (opts: UpdateOpts) => {
    this._ensureRemote(false)
    this._ensureStackNameKnown()

    await update(this, {
      stackName: this.stackName,
      ...opts,
    })
  }

  public updateManually = async (opts: ApplyUpdateOpts) => {
    await this.applyUpdateAsCurrentUser(opts)
    await this.waitForStackUpdate()
  }

  public rollback = async (opts: UpdateOpts) => {
    this._ensureRemote(false)
    this._ensureStackNameKnown()

    await update(this, {
      stackName: this.stackName,
      rollback: true,
      ...opts,
    })
  }

  public applyUpdateAsCurrentUser = async (update: ApplyUpdateOpts) => {
    this._ensureRemote(false)
    this._ensureStackNameKnown()
    const { templateUrl, notificationTopics } = update
    const params:AWS.CloudFormation.UpdateStackInput = {
      StackName: this.stackId || this.stackName,
      TemplateURL: templateUrl,
      Capabilities: ['CAPABILITY_NAMED_IAM'],
    }

    if (notificationTopics) {
      params.NotificationARNs = notificationTopics
    }

    await this.client.cloudformation.updateStack(params).promise()
  }

  public applyUpdateViaLambda = async (update) => {
    const { templateUrl, notificationTopics } = update
    return await this.invokeAndReturn({
      functionName: 'updateStack',
      arg: { templateUrl, notificationTopics }
    })
  }

  private _ensureStackNameKnown = () => {
    if (this.remote && !this.stackName) {
      throw new CustomErrors.InvalidInput(`hm...are you sure you're in the right directory?`)
    }
  }

  private _invoke = async ({ functionName, arg={}, noWarning }: InvokeOpts) => {
    // confirm if remote was not explicitly specified
    if (!(this.remote || noWarning)) {
      await confirmOrAbort(`Targeting REMOTE deployment. Continue?`)
    }

    this._ensureStackNameKnown()

    const {
      StatusCode,
      Payload,
      FunctionError
    } = await this.client.lambda.invoke({
      InvocationType: 'RequestResponse',
      FunctionName: this.getLongFunctionName(functionName),
      Payload: JSON.stringify(arg)
    }).promise()

    if (FunctionError || StatusCode >= 300) {
      const message = Payload || FunctionError
      throw new Error(message.toString())
    }

    return JSON.parse(Payload.toString())
  }

  private _invokeLocal = async ({ functionName, arg }: InvokeOpts) => {
    const { project, nodeFlags } = this
    const flagsStr = Object.keys(nodeFlags)
      .filter(key => nodeFlags[key])
      .map(key => `--${key}`)
      .join(' ')

    if (typeof arg !== 'string') arg = JSON.stringify(arg)

    const tmpInput = tmp.fileSync({ postfix: '.json' })
    const tmpOutput = tmp.fileSync({ postfix: '.json' })
    write(tmpInput.name, JSON.stringify(arg))

    const pwd = process.cwd()
    shelljs.cd(project)
    logger.debug('be patient, local invocations can be slow')
    const envVars:any = _.pick(process.env, ['SERVERLESS_OFFLINE_APIGW'])
    if (!envVars.IS_OFFLINE) envVars.IS_OFFLINE = '1'

    const command =`${stringifyEnv(envVars)} node ${flagsStr} \
  "${project}/node_modules/.bin/sls" invoke local \
  -f "${functionName}" \
  -l false \
  --path "${tmpInput.name}" \
  --output "${tmpOutput.name}"`

    logger.debug(`running command: ${command}`)
    const result = shelljs.exec(command, { silent: true })
    shelljs.cd(pwd)
    const res = read(tmpOutput.name).trim()
    if (result.code !== 0) throw new Error(`invoke failed: ${res || result.stderr}`)

    return res && JSON.parse(res)
  }
}

export const createConf = (opts: ConfOpts) => new Conf(opts)

const stringifyEnv = props => Object.keys(props).map(key => `${key}="${props[key]}"`).join(' ')
