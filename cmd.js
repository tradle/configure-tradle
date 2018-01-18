#!/usr/bin/env node

const path = require('path')
const _ = require('lodash')
const AWS = require('aws-sdk')
const yn = require('yn')
const DEPLOY_ITEMS = [
  'bot',
  'models',
  'style',
  'terms'
]

const NODE_FLAGS = [
  'inspect',
  'debug',
  'debug-brk'
]

const argv = require('minimist')(process.argv.slice(2), {
  boolean: DEPLOY_ITEMS,
  alias: {
    b: 'bot',
    m: 'models',
    s: 'style',
    t: 'terms',
    // aws cli settings
    p: 'profile',
    l: 'local',
    // path to serverless project
    x: 'project'
  }
})

const isLocal = argv.local || yn(process.env.local)
if (isLocal) {
  console.log('DEPLOYING TO LOCAL ENVIRONMENT')
} else {
  console.log('DEPLOYING TO REMOTE ENVIRONMENT')
}

require('dotenv').config({
  path: path.resolve(process.cwd(), argv.local ? '.env' : '.env.local')
})

const { deploy } = require('./lib/deploy')
const {
  aws_profile,
  stack_name
} = process.env

if (aws_profile) {
  AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: aws_profile })
}

const prettify = obj => JSON.stringify(obj, null, 2)

deploy({
    items: _.pick(argv, DEPLOY_ITEMS),
    stackName: stack_name,
    lambda: new AWS.Lambda(),
    local: isLocal,
    dir: isLocal && argv.project,
    nodeFlags: _.pick(argv, NODE_FLAGS)
  })
  .then(result => console.log(prettify(result)))
  .catch(err => {
    console.error(err.stack)
    process.exitCode = 1
  })
