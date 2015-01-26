var _ = require('lodash');
var asap = require('asap');

exports = module.exports = function(picks) {
  return function(obj, callback) {
    asap(callback.bind(this, null, _.pick(obj, picks), obj))
  };
};
