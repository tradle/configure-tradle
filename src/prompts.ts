import fs from 'fs'
import os from 'os'
// import execa from 'execa'
import inquirer from 'inquirer'
import Listr from 'listr'
import models from '@tradle/models-cloud'
import Errors from '@tradle/errors'
import { Errors as CustomErrors } from './errors'
import { logger } from './logger'
import { isValidProjectPath } from './utils'
import { Conf } from './types'

const regions = models['tradle.cloud.AWSRegion'].enum.map(({ id, title }) => ({
  name: title,
  value: id.replace(/[.]/g, '-')
}))

const PROFILE_REGEX = /^\[(?:[^\s]*?\s)?(.*)\]$/
const getProfileName = line => line.match(PROFILE_REGEX)[1]
const parseConf = conf => ({
  profiles: conf.split('\n')
    .filter(s => s.startsWith('['))
    .map(getProfileName)
})

const getProfiles = () => {
  let conf
  try {
    conf = fs.readFileSync(`${os.homedir()}/.aws/credentials`, { encoding: 'utf8' })
  } catch (err) {
    return ['default']
  }

  const { profiles } = parseConf(conf)
  return profiles.includes('default') ? profiles : ['default'].concat(profiles)
}

type PromptList = any[]

export const init = async (conf: Conf) => {
  const defaultWhen = answers => answers.overwriteEnv !== false
  const chooseFlow:PromptList = [
    {
      type: 'confirm',
      name: 'overwriteEnv',
      message: 'This will overwrite your .env file',
      when: () => fs.existsSync('./.env')
    },
    {
      type: 'confirm',
      name: 'haveRemote',
      message: 'Have you already deployed your MyCloud to AWS?'
    }
  ]

  const getLocal:PromptList = [
    {
      type: 'confirm',
      name: 'haveLocal',
      message: 'Do you have a local development environment? (a clone of https://github.com/tradle/serverless)'
    },
    {
      type: 'input',
      name: 'projectPath',
      message: 'Enter the path to your local development environment (a clone of https://github.com/tradle/serverless)',
      when: answers => defaultWhen(answers) && answers.haveLocal,
      validate: local => {
        if (!isValidProjectPath(local)) {
          return 'Provided path doesn\'t contain a serverless.yml, please try again'
        }

        return true
      }
    }
  ]

  const flow = await inquirer.prompt(chooseFlow)
  if (!flow.haveRemote) {
    return {
      ...flow,
      ...(await inquirer.prompt(getLocal))
    }
  }

  const getRemoteAndLocal:PromptList = [
    {
      type: 'list',
      name: 'region',
      message: 'Which AWS region is your deployment in?',
      choices: regions
    },
    {
      type: 'list',
      name: 'awsProfile',
      message: 'Select your aws profile',
      when: defaultWhen,
      choices: getProfiles()
        .map(profile => ({
          name: profile,
          value: profile
        }))
        .concat([
          new inquirer.Separator(),
          {
            name: 'Other (specify)',
            value: null
          }
        ]),
    },
    {
      type: 'input',
      name: 'awsProfile',
      message: 'profile',
      when: answers => answers.overwriteEnv && !answers.awsProfile
    },
    {
      type: 'list',
      name: 'stack',
      message: 'Which Tradle stack will you be configuring?',
      when: defaultWhen,
      choices: async ({ region, awsProfile }) => {
        const stackInfos = await conf.getStacks({
          profile: awsProfile,
          region
        })

        if (!stackInfos.length) {
          throw new Error('no stacks found')
        }

        return stackInfos.map(({ name, id }) => ({
          name,
          value: { name, id }
        }))
      }
    },
  ].concat(getLocal)

  return {
    ...flow,
    ...(await inquirer.prompt(getRemoteAndLocal))
  }
}

export const fn = (conf: Conf, message: string) => {
  return inquirer.prompt([
    {
      type: 'list',
      name: 'fn',
      message,
      choices: conf.getFunctions
    }
  ])
  .then(({ fn }) => fn)
}

export const confirm = (message: string) => {
  return inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message
    }
  ])
  .then(({ confirm }) => confirm)
}

