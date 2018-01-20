const _ = require('lodash')

module.exports = _.extend(
  {},
  require('@tradle/models').models,
  require('@tradle/custom-models')
)
