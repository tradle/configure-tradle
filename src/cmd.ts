#!/usr/bin/env node

require('source-map-support').install()

// @ts-ignore
process.env.AWS_SDK_LOAD_CONFIG = true

import updateNotifier from 'update-notifier'
import Errors from '@tradle/errors'
import chalk from 'chalk'
import { Errors as CustomErrors } from './errors'
import { logger } from './logger'
import { Conf } from './types'

const pkg = require('../package.json')
const DESC = {
  key: 'key returned by create-data-bundle command'
}

updateNotifier({
  pkg,
  updateCheckInterval: 60 * 60 * 1000 // 1 hr
}).notify()

require('dotenv').config({
  path: '.env'
})

import _ = require('lodash')
import { prettify, isValidProjectPath } from './utils'

const printHelp = () => {
  const commands = program.commands
    .filter(c => c.description())

  logger.info(
    commands
      .map(c => `${chalk.blue(c.name())}\n\n${chalk.white(getCommandHelp(c))}`)
      .join('\n\n')
  )
}

const getCommandHelp = c => {
  const desc = c.description()
  return desc
    .split('\n')
    .map(line => `\t${line}`)
    .join('\n')
}

const getCommandName = command => {
  if (typeof command === 'string') return command

  return command && command.name()
}

const NODE_FLAGS = [
  'inspect',
  'inspect-brk',
  'debug',
  'debug-brk'
]

const PROGRAM_OPTS = [
  'local',
  'remote',
  'project'
].concat(NODE_FLAGS)

let matchedCommand

const normalizeOpts = (...args) => {
  const command = matchedCommand = args.pop()
  const programOpts = _.defaults(_.pick(program, PROGRAM_OPTS), defaults.programOpts)
  if (program.debugBrk) {
    programOpts['debug-brk'] = true
  }

  const { local, remote } = programOpts
  if (command.name() !== 'validate') {
    const envType = local ? 'local' : 'remote'
    logger.debug(`targeting ${envType} environment`)
  }

  const commandOpts = _.pick(command, command.options.map(o => o.attributeName()))
  commandOpts.args = args
  return {
    commandOpts,
    programOpts: _.extend(_.omit(programOpts, NODE_FLAGS), {
      lambda: new AWS.Lambda(),
      nodeFlags: _.pick(programOpts, NODE_FLAGS)
    })
  }
}

const createAction = (action: keyof Conf) => (...args) => {
  const { programOpts, commandOpts } = normalizeOpts(...args)
  return run(() => {
    const conf:Conf = createConf(programOpts)
    if (!conf[action]) {
      throw new CustomErrors.InvalidInput(`conf method not found: ${action}`)
    }

    // @ts-ignore
    return conf[action](commandOpts)
  })
}

const run = async (fn) => {
  let result
  try {
    result = await fn()
  } catch (err) {
    process.exitCode = 1
    if (Errors.matches(err, 'developer')) {
      logger.error(err.stack)
    } else if (Errors.matches(err, CustomErrors.UserAborted)) {
      logger.info('command canceled')
    } else {
      logger.error(err.message)
      ;(matchedCommand || program).outputHelp()
    }

    process.exit()
    return
  }

  if (result == null) {
    // logger.info('OK')
  } else {
    logger.info(prettify(result))
  }
}

const program = require('commander')
program
  .version(pkg.version)
  .option('-l, --local', 'target local development environment')
  .option('-r, --remote', 'target remote environment')
  .option('-x, --project [path]', 'path to serverless project on disk')
  .option('--inspect', 'invoke serverless function under the debugger')
  .option('--inspect-brk', 'invoke serverless function under the debugger')
  .option('--debug', 'invoke serverless function under the debugger')
  .option('--debug-brk', 'invoke serverless function under the debugger')

program.on('--help', () => logger.warn('\nuse the `help` command to get command-specific help'))
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

// pre-parse to determine which env vars to load, local or remote
program.parse(process.argv)
const defaults = {
  programOpts: {
    stackName: process.env.stackName,
    stackId: process.env.stackId,
    profile: process.env.awsProfile,
    region: process.env.region,
    namespace: process.env.namespace,
    project: process.env.project
  }
}

const {
  profile=defaults.programOpts.profile,
  region=defaults.programOpts.region,
} = program

if (profile) {
  process.env.AWS_PROFILE = profile
}

if (region) {
  process.env.AWS_REGION = region
}

const deployCommand = program
  .command('deploy')
  .description(`push your local configuration`)
  .option('-m, --models', 'deploy models')
  .option('-s, --style', 'deploy style')
  .option('-t, --terms', 'deploy terms')
  .option('-b, --bot', 'deploy bot configuration')
  .option('-a, --all', 'deploy all configuration')
  .option('--dry-run', 'print but don\'t execute')
  .allowUnknownOption(false)
  .action(createAction('deploy'))

const loadCommand = program
  .command('load')
  .description(`load the currently deployed configuration`)
  .option('-m, --models', 'load models')
  .option('-s, --style', 'load style')
  .option('-t, --terms', 'load terms')
  .option('-b, --bot', 'load bot configuration')
  .option('-a, --all', 'load all configuration')
  .option('--dry-run', 'print but don\'t execute')
  .action(createAction('load'))

const validateCommand = program
  .command('validate')
  .description(`[DEPRECATED] validate your local models and lenses

This command is deprecated. Validation is done cloud-side regardless.`)
  .option('-m, --models', 'validate models and lenses')
  .option('-s, --style', 'validate style')
  .option('-t, --terms', 'validate terms')
  .option('-b, --bot', 'validate bot configuration')
  .option('-a, --all', 'validate all configuration')
  .allowUnknownOption(false)
  .action(createAction('validate'))

const createDataBundleCommand = program
  .command('create-data-bundle')
  .description(`upload a data bundle`)
  .option('-p, --path <path>', 'path to bundle to create')
  .allowUnknownOption(false)
  .action(createAction('createDataBundle'))

const createDataClaimCommand = program
  .command('create-data-claim')
  .description(`create a claim stub for a data bundle`)
  .option('-k, --key <key>', DESC.key)
  .option('-c, --claimType <claimType>', '"prefill" or "bulk"')
  .allowUnknownOption(false)
  .action(createAction('createDataClaim'))

const getDataBundleCommand = program
  .command('get-data-bundle')
  .description(`get a data bundle by its claimId and key`)
  .option('-c, --claimId <claimId>', 'claim id returned by create-data-claim command')
  .option('-k, --key <key>', DESC.key)
  .allowUnknownOption(false)
  .action(createAction('getDataBundle'))

const listDataClaimsCommand = program
  .command('list-data-claims')
  .description(`list existing claim stubs for data bundles`)
  .option('-k, --key <key>', DESC.key)
  .allowUnknownOption(false)
  .action(createAction('listDataClaims'))

const initCommand = program
  .command('init')
  .description(`initialize your local configuration (re-generate your .env file)`)
  // .option('-p, --profile <profile>', 'the AWS profile name, if you know it')
  // .option('-s, --stack-name <stackName>', `your MyCloud's stack name in AWS, if you know it`)
  .allowUnknownOption(false)
  .action(createAction('init'))

const execCommand = program
  .command('exec <command>')
  .description(`execute a command on the remote cli`)
  .allowUnknownOption(false)
  .action(createAction('exec'))

const invokeCommand = program
  .command('invoke')
  .description(`invoke a function`)
  .option('-f, --function-name <functionName>', 'invoke a lambda by name')
  .allowUnknownOption(false)
  .action(createAction('invoke'))

const destroyCommand = program
  .command('destroy')
  .description(`destroy your deployment`)
  .allowUnknownOption(false)
  .action(createAction('destroy'))

const infoCommand = program
  .command('info')
  .description(`get some app links and other basic info for your deployment`)
  .allowUnknownOption(false)
  .action(createAction('info'))

const disableCommand = program
  .command('disable')
  .description(`disable your stack (turn off the lambdas)`)
  .allowUnknownOption(false)
  .action(createAction('disable'))

const enableCommand = program
  .command('enable')
  .description(`enable your stack (turn on the lambdas)`)
  .allowUnknownOption(false)
  .action(createAction('enable'))

const balanceCommand = program
  .command('balance')
  .description(`check the balance on your blockchain key`)
  .allowUnknownOption(false)
  .action(createAction('balance'))

const versionCommand = program
  .command('get-current-version')
  .description(`check your current MyCloud version`)
  .allowUnknownOption(false)
  .action(createAction('getCurrentVersion'))

const listPreviousVersionsCommand = program
  .command('list-previous-versions')
  .description('list previous versions of your MyCloud deployment')
  .allowUnknownOption(false)
  .action(createAction('listPreviousVersions'))

const updateCommand = program
  .command('update')
  .option('-t, --tag <versionTag>')
  .option('-f, --force', 'force update even if deployment is ahead of or equal to the specified version tag')
  .option('-c, --show-release-candidates', 'set if you want to list release candidate versions')
  // .option('-p, --provider <providerPermalink>', 'if you want to update from someone other than Tradle')
  .description('update your MyCloud')
  .allowUnknownOption(false)
  .action(createAction('update'))

const updateManuallyCommand = program
  .command('update-manually')
  .option('-t, --template-url <templateUrl>', 'stack template url')
  .description('[ADVANCED] update your MyCloud to a given stack template')
  .allowUnknownOption(false)
  .action(createAction('updateManually'))

const rollbackCommand = program
  .command('rollback')
  .option('-t, --tag <versionTag>')
  .option('-c, --show-release-candidates', 'set if you want to list release candidate versions')
  // .option('-p, --provider <providerPermalink>', 'if you want to update from someone other than Tradle')
  .description('roll your MyCloud back to a version you previously deployed')
  .allowUnknownOption(false)
  .action(createAction('rollback'))

// const requestUpdateCommand = program
//   .command('request-update')
//   .option('-t, --tag <versionTag>')
//   // .option('-p, --provider <providerPermalink>', 'if you want to update from someone other than Tradle')
//   .description('request an update for a given version')
//   .allowUnknownOption(false)
//   .action(createAction('requestUpdate'))

const listUpdatesCommand = program
  .command('list-updates')
  .description('list available updates for your MyCloud')
  .allowUnknownOption(false)
  .action(createAction('listUpdates'))

const createLogCommand = (command, name) => command
  .allowUnknownOption(false)
  .option('-s, --start <time-expression>', 'see awslogs docs')
  .option('-e, --end <time-expression>', 'see awslogs docs')
  .option('-w, --watch', 'tail log')
  .option('-t, --timestamp', 'prints the creation timestamp of each event.')
  .option('-i, --ingestion-time', 'prints the ingestion time of each event.')
  .option('-f, --filter-pattern', 'CloudWatch Logs filter pattern')
  .option('-q, --query', 'CloudWatch Logs query pattern')
  .action(createAction(name))

const logCommand = createLogCommand(program
  .command('log [functionName]')
  .description(`view/tail a function's logs.

Passes options through to awslogs (https://github.com/jorgebastida/awslogs)

Make sure to put spaces between options.

Right: tradleconf log oniotlifecycle -s 1d
Wrong: tradleconf log oniotlifecycle -s1d

`), 'log')

const tailCommand = createLogCommand(program
  .command('tail [functionName]')
  .description(`tail a function's logs. Equivalent to log -w`), 'tail')

const graphiqlCommand = program
  .command('graphiql')
  .description('open GraphiQL in the browser')
  .allowUnknownOption(false)
  .action(run.bind(null, async () => {
    matchedCommand = graphiqlCommand
    const { apiBaseUrl } = process.env
    if (!apiBaseUrl) {
      throw new Error('did you forget to run init?')
    }

    await require('opn')(`${apiBaseUrl}/graphql`, { wait: false })
  }))

// require AWS sdk after env variables are set
const AWS = require('aws-sdk')
const { createConf } = require('./')
// re-parse with env vars set

const helpCommand = program
  .command('help')
  .action(printHelp)

program.parse(process.argv)
// if (typeof parseResult.args[0] === 'string') {
if (!matchedCommand) {
  logger.error(`command not found with name: ${process.argv[2]}`)
}
