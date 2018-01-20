const _ = require('lodash')
const builtInModels = require('./models')
const mergeModels = require('@tradle/merge-models')
const ModelsPack = require('@tradle/models-pack')
const utils = require('./utils')

exports.modelsPack = ({ namespace, models, lenses }) => {
  // validate model set
  mergeModels()
    .add(builtInModels, { validate: false })
    .add(models)

  // validate pack
  utils.pack({ namespace, models, lenses })
}

exports.bot = conf => {
  const { tours } = conf
  if (tours) {
    _.each(tours, tour => utils.validateResource(tour))
  }
}

exports.style = style => utils.validateResource(style)

exports.terms = terms => {
  if (!terms.length) {
    throw new Error('terms and conditions cannot be empty')
  }

  const marked = require('marked')
  try {
    marked(terms)
  } catch (err) {
    throw new Error(`expected terms and conditions to be valid markdown: ${err.message}`)
  }
}
