import matches from 'lodash/matches'
import sortBy from 'lodash/sortBy'
import inquirer from 'inquirer'
import Listr from 'listr'
import promiseRetry from 'promise-retry'
// import { toSortableTag, sortTags, compareTags } from 'lexicographic-semver'
import Errors from '@tradle/errors'
import { Conf, UpdateOpts, VersionInfo, GetUpdateInfoResp } from './types'
import { Errors as CustomErrors } from './errors'
import { logger } from './logger'
import { confirmOrAbort } from './utils'

const USE_CURRENT_USER_ROLE = true
const MIN_VERSION = '01.01.0f'

interface UpdateHelperOpts extends UpdateOpts {
  currentVersion: VersionInfo
  updates: VersionInfo[]
}

class Updater {
  private conf: Conf
  private opts: UpdateOpts
  private updates: VersionInfo[]
  private currentVersion: VersionInfo
  private targetTag: string
  private verb: string
  constructor({ conf, opts, currentVersion, updates }: {
    conf: Conf
    opts: UpdateOpts
    currentVersion?: VersionInfo
    updates?: VersionInfo[]
  }) {
    // if (opts.rollback) {
    //   throw new Error('rollback command not supported at the moment')
    // }

    this.conf = conf
    this.opts = opts
    this.currentVersion = currentVersion
    this.updates = updates
    this.targetTag = opts.tag
    this.verb = opts.rollback ? 'rollback' : 'update'
  }

  public update = async () => {
    const { targetTag, currentVersion, updates, opts } = this
    const { provider, rollback } = opts
    if (!currentVersion) {
      this.currentVersion = await this.conf.getCurrentVersion()
    }

    if (!updates) {
      this.updates = await this._loadUpdates()
    }

    if (targetTag && rollback) {
      const idx = this.updates.findIndex(matches({ tag: targetTag }))
      if (idx === -1) {
        const previousTags = updates.map(u => u.tag)
        // we don't know what versions are available yet
        throw new Error(`your MyCloud was never previously deployed with version ${targetTag}

Your previously deployed versions are (most recently deployed at the top):

${previousTags.join('\n')}`)
      }
    }

    await this._update()
  }

  private _loadUpdates = async () => {
    const { conf, opts, currentVersion } = this
    const { rollback, provider } = opts
    const getUpdates = rollback
      ? conf.listPreviousVersions()
      : conf.listUpdates({ provider })

    let updates = await getUpdates
    updates = sortBy(updates, 'sortableTag')
    updates = updates.filter(u => u.tag !== currentVersion.tag)
    if (rollback) {
      updates = updates.reverse().filter(u => u.sortableTag < currentVersion.sortableTag)
    }

    return updates
  }

  private _loadTargetTag = async () => {
    // filter here, not above
    // because applyPrerequisiteTransitionTags needs to see all updates
    const { verb, updates, opts } = this
    const { rollback, showReleaseCandidates } = opts
    let choices = updates.slice()
    const noRC = !rollback && !showReleaseCandidates
    if (noRC) {
      choices = choices.filter(update => !isReleaseCandidateTag(update.tag))
    }

    if (!choices.length) {
      throw new Error(`no ${verb} available`)
    }

    let message
    if (rollback) {
      message = `Choose a version to roll back to (most recently deployed at the top)`
    } else {
      message = `Choose a version to update to`
    }

    const result = await inquirer.prompt([{
      type: 'list',
      name: 'tag',
      message,
      choices: choices.map(({ tag }) => ({
        name: getChoiceTextForTag(tag),
        value: tag
      })),
    }])

    this.targetTag = result.tag
  }

  private _update = async () => {
    const { conf, opts, currentVersion, updates, verb } = this
    const {
      stackName,
      provider,
      showReleaseCandidates,
      force,
      rollback,
    } = opts

    if (!(currentVersion.sortableTag && currentVersion.sortableTag > MIN_VERSION)) {
      throw new Error(`you have an old version of MyCloud which doesn't support the new update mechanism
  Please update manually this one time. See instructions on https://github.com/tradle/serverless`)
    }

    if (!this.targetTag) {
      await this._loadTargetTag()
    }

    if (!rollback && currentVersion.templateUrl) {
      logger.info(`
should the worst happen and you need to manually roll back to this version later, run:

tradleconf update-manually --template-url "${currentVersion.templateUrl}"
`)
    }

    const tag = this.targetTag
    if (!force) {
      await this._applyPrerequisiteTransitionTags()
    }

    const promise = await new Listr([
      {
        title: `load release ${tag} (grab a coffee)`,
        task: async ctx => {
          const resp = await this._getUpdateWithRetry()
          if (!resp) return

          const { update, upToDate } = resp
          ctx.upToDate = upToDate
          ctx.update = update
          ctx.willUpdate = force || rollback || !upToDate
        }
      },
      {
        title: `validate release`,
        skip: ctx => !ctx.willUpdate,
        task: async ctx => {
          try {
            await this._triggerUpdate(ctx.update)
          } catch (err) {
            if (err.code === 'ValidationError' && err.message.includes('UPDATE_IN_PROGRESS')) {
              throw new Error('stack is currently updating, please wait for it to finish before applying another update')
            }

            throw err
          }
        }
      },
      {
        title: `apply ${verb} (be patient, or else)`,
        skip: ctx => !ctx.willUpdate,
        task: async ctx => {
          try {
            await conf.waitForStackUpdate({ stackName })
          } catch (err) {
            if (err.code === 'ResourceNotReady') {
              throw new Error(`failed to apply ${verb}`)
            }

            throw err
          }
        }
      }
    ]).run()

    let ctx
    try {
      ctx = await promise
    } catch (err) {
      if (Errors.matches(err, CustomErrors.NotFound)) {
        throw new Error(`failed to fetch version ${tag}. If you're confident it exists, please try again.`)
      }

      throw err
    }

    if (ctx.upToDate && !ctx.willUpdate) {
      if (tag === currentVersion.tag) {
        throw new Error(`your MyCloud is already up to date!`)
      }

      this._throwBackwardsError()
    }
  }

  private _throwBackwardsError = () => {
    const { currentVersion, targetTag } = this
    throw new Error(`your MyCloud is of a more recent version: ${currentVersion.tag}

To force deploy ${targetTag}, run: tradleconf update --tag ${targetTag} --force`)
  }

  private _getUpdateWithRetry = async ():Promise<GetUpdateInfoResp> => {
    const tag = this.targetTag
    const { conf, opts } = this
    const { provider } = opts
    let requested
    // this might take a few tries as the update might need to be requested first
    return promiseRetry(async (retry, number) => {
      try {
        return await conf.getUpdateInfo({ tag })
      } catch (err) {
        Errors.rethrow(err, ['developer', CustomErrors.InvalidInput])
        if (!requested && Errors.matches(err, CustomErrors.NotFound)) {
          requested = true
          await conf.requestUpdate({ tag, provider })
        }

        retry(err)
      }
    }, {
      maxTimeout: 10000,
      minTimeout: 5000,
      retries: 10
    })
  }

  private _applyPrerequisiteTransitionTags = async () => {
    const { updates, currentVersion, targetTag } = this
    const idx = updates.findIndex(update => update.tag === targetTag)
    if (idx === -1) return

    const transition = updates.slice(0, idx).find(update => isTransitionReleaseTag(update.tag))
    if (!transition) return

    logger.info(`you must apply the transition version first: ${transition.tag}`)
    await confirmOrAbort(`apply transition tag ${transition.tag} now?`)
    await update(this.conf, {
      ...this.opts,
      force: true,
      tag: transition.tag,
      currentVersion,
      updates,
    })
  }

  private _triggerUpdate = async (update) => {
    const { conf } = this
    if (USE_CURRENT_USER_ROLE) {
      await conf.applyUpdateAsCurrentUser(update)
    } else {
      await conf.applyUpdateViaLambda(update)
    }
  }
}

const isReleaseCandidateTag = (tag: string) => /-rc\.\d+$/.test(tag)
const isTransitionReleaseTag = (tag: string) => /-trans/.test(tag)
const getChoiceTextForTag = (tag: string) => {
  if (isTransitionReleaseTag(tag)) {
    return `${tag} (transition version, must be applied before the version that follows)`
  }

  if (isReleaseCandidateTag(tag)) {
    return `${tag} (release candidate with experimental fixes / features)`
  }

  return tag
}

export const update = (
  conf: Conf,
  opts: UpdateOpts|UpdateHelperOpts
) => new Updater({ conf, opts }).update()
