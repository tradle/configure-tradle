#!/usr/bin/env node

process.env.AWS_SDK_LOAD_CONFIG = true

const updateNotifier = require('update-notifier')

const pkg = require('./package.json')
updateNotifier({
  pkg,
  updateCheckInterval: 60 * 60 * 1000 // 1 hr
}).notify()

require('dotenv').config({
  path: '.env'
})

const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const yn = require('yn')
const { debug, prettify } = require('./lib/utils')
const HELP = `
  Commands:
    validate
    load
    deploy

  To get help for a command, use --help, e.g.: tradleconf validate --help
`
const printHelp = () => console.log(HELP)
const getCommandName = command => {
  if (typeof command === 'string') return command

  return command && command.name()
}

const COMMAND_OPTS = [
  'all',
  'bot',
  'models',
  'style',
  'terms'
]

const NODE_FLAGS = [
  'debug',
  'debug-brk'
]

const PROGRAM_OPTS = [
  'profile',
  'local',
  'project'
].concat(NODE_FLAGS)

const normalizeOpts = opts => {
  const programOpts = _.defaults(_.pick(program, PROGRAM_OPTS), defaults.programOpts)
  if (program.debugBrk) {
    programOpts['debug-brk'] = true
  }

  const commandOpts = _.defaults(_.pick(opts, COMMAND_OPTS), defaults.commandOpts)
  if (_.every(commandOpts, val => !val)) {
    commandOpts.all = true
  }

  // opts = _.pickBy(opts, (value, key) => key in defaults)
  // opts = _.defaults(opts, defaults)
  const { local, project } = programOpts
  if (local) {
    if (!project) {
      throw new Error('expected "--project"')
    }

    if (!fs.existsSync(path.resolve(__dirname, project, 'serverless.yml'))) {
      throw new Error('expected "--project" to point to serverless project dir')
    }
  }

  const command = program.args[0]
  if (getCommandName(command) !== 'validate') {
    const envType = local ? 'local' : 'remote'
    debug(`targeting ${envType} environment`)
  }

  if (commandOpts.all) {
    COMMAND_OPTS.forEach(opt => commandOpts[opt] = true)
  }

  commandOpts.args = program.args
  return {
    commandOpts,
    programOpts: {
      stackName: programOpts.stackName,
      lambda: new AWS.Lambda(),
      project,
      local,
      nodeFlags: _.pick(programOpts, NODE_FLAGS)
    }
  }
}

const createAction = action => {
  return opts => {
    const { programOpts, commandOpts } = normalizeOpts(opts)
    return run(() => {
      const conf = new Conf(programOpts)
      return conf[action](commandOpts)
    })
  }
}

const run = fn => Promise.resolve()
  .then(fn)
  .then(result => {
    if (typeof result !== 'undefined') {
      console.log(prettify(result))
    }
  })
  .catch(err => {
    console.error(err.stack)
    process.exitCode = 1
  })

const program = require('commander')
program
  .version(pkg.version)
  .option('-p, --profile', 'AWS profile to use')
  .option('-l, --local', 'target local development environment')
  .option('-x, --project [path]', 'path to serverless project on disk')
  .option('--debug', 'invoke serverless function under the debugger')
  .option('--debug-brk', 'invoke serverless function under the debugger')

program.on('--help', printHelp)
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

// pre-parse to determine which env vars to load, local or remote
program.parse(process.argv)
const defaults = {
  programOpts: {
    stackName: process.env.stack_name,
    profile: process.env.aws_profile,
  },
  commandOpts: {
    models: false,
    style: false,
    terms: false,
    bot: false
  }
}

const { profile=defaults.programOpts.profile } = program
if (profile) {
  process.env.AWS_PROFILE = profile
}

const deployCommand = program
  .command('deploy')
  // .description('deploy ')
  .option('-m, --models', 'deploy models')
  .option('-s, --style', 'deploy style')
  .option('-t, --terms', 'deploy models')
  .option('-b, --bot', 'deploy bot configuration')
  .option('-a, --all', 'deploy all configuration')
  .action(createAction('deploy'))

const loadCommand = program
  .command('load')
  .option('-m, --models', 'load models')
  .option('-s, --style', 'load style')
  .option('-t, --terms', 'load models')
  .option('-b, --bot', 'load bot configuration')
  .option('-a, --all', 'load all configuration')
  .action(createAction('load'))

const validateCommand = program
  .command('validate')
  .option('-m, --models', 'validate models and lenses')
  .option('-s, --style', 'validate style')
  .option('-t, --terms', 'validate models')
  .option('-b, --bot', 'validate bot configuration')
  .option('-a, --all', 'validate all configuration')
  .action(createAction('validate'))

const execCommand = program
  .command('exec <command>')
  .action(createAction('exec'))

const initCommand = program
  .command('init')
  .action(createAction('init'))

// require AWS sdk after env variables are set
const AWS = require('aws-sdk')
const Conf = require('./')
// re-parse with env vars set
program.parse(process.argv)
