const _ = require('lodash')
// const debug = require('debug')('@tradle/configure-tradle')
const debug = (...args) => console.log(...args)
const ModelsPack = require('@tradle/models-pack')
const _validateResource = require('@tradle/validate-resource')
const builtInModels = require('./models')

const getNamespace = ({ models, lenses }) => {
  const model = _.values(models)[0] || _.values(lenses)[0]
  return model && ModelsPack.getNamespace(model.id)
}

const pack = ({ namespace, models, lenses }) => {
  if (!(_.size(models) || _.size(lenses))) {
    throw new Error('expected "models" and/or "lenses"')
  }

  if (!namespace) {
    namespace = getNamespace({ models, lenses })
  }

  const modelsPack = ModelsPack.pack({ namespace, models, lenses })
  ModelsPack.validate({ builtInModels, modelsPack })
  return modelsPack
}

const validateResource = resource => _validateResource({
  models: builtInModels,
  resource
})

const prettify = obj => {
  return typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)
}

module.exports = {
  getNamespace,
  pack,
  validateResource,
  debug,
  prettify
}
