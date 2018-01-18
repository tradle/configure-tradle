const path = require('path')
const fs = require('fs')
const _ = require('lodash')
const co = require('co')
const AWS = require('aws-sdk')
const shelljs = require('shelljs')
const ModelsPack = require('@tradle/models-pack')
const termsPath = path.resolve(__dirname, '../conf/terms-and-conditions.md')
const localFunctionName = 'setconf'
const getSetConfFunctionName = stackName => `${stackName}-${localFunctionName}`
const firstKey = obj => {
  for (let key in obj) return key
}

const getItems = opts => {
  const parts = {}
  if (opts.style) {
    parts.style = require('../conf/style')
  }

  if (opts.terms) {
    parts.terms = fs.readFileSync(termsPath)
  }

  if (opts.models) {
    const models = {}
    if (fs.existsSync(path.resolve(__dirname, '../conf/models.json'))) {
      models.models = require('../conf/models.json')
      models.namespace = ModelsPack.getNamespace(firstKey(models.models))
    }

    if (fs.existsSync(path.resolve(__dirname, '../conf/lenses.json'))) {
      models.lenses = require('../conf/lenses.json')
    }

    parts.modelsPack = ModelsPack.pack(models)
  }

  if (opts.bot) {
    parts.bot = require('../conf/bot')
  }

  return parts
}

const deploy = co.wrap(function* (opts) {
  const {
    local,
    items,
    stackName,
    lambda
  } = opts

  if (local) {
    return yield deployLocal(opts)
  }

  const input = getItems(items)
  const {
    StatusCode,
    Payload,
    FunctionError
  } = yield lambda.invoke({
    InvocationType: 'RequestResponse',
    FunctionName: getSetConfFunctionName(stackName),
    Payload: JSON.stringify(input)
  }).promise()

  if (FunctionError || StatusCode >= 300) {
    const message = Payload || FunctionError
    throw new Error(message.toString())
  }

  return Payload
})

const deployLocal = co.wrap(function* ({
  items,
  stackName,
  dir,
  nodeFlags={}
}) {
  if (!dir) {
    throw new Error('expected "dir", the path to your local serverless project')
  }

  if (!nodeFlags.inspect && (nodeFlags.debug || nodeFlags['debug-brk'])) {
    nodeFlags.inspect = true
  }

  const input = getItems(items)
  const FunctionName = getSetConfFunctionName(stackName)
  const flagsStr = Object.keys(nodeFlags)
    .filter(key => nodeFlags[key])
    .map(key => `--${key}="${nodeFlags[key]}"`)
    .join(' ')

  const command =`IS_OFFLINE=1 node ${flagsStr} $(command -v serverless) invoke local -f ${localFunctionName}`
  return yield new Promise((resolve, reject) => {
    shelljs.cd(dir)
    shelljs
      .echo(JSON.stringify(input))
      // pipe
      .exec(command, (code, stdout, stderr) => {
        if (code === 0) return resolve(stdout)

        throw new Error(stderr || `failed with code ${code}`)
      })
  })
})

module.exports = {
  deploy
}
