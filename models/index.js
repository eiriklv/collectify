'use strict';

exports = module.exports = function(mongoose) {
  return {
    Entry: require('./entry')(mongoose),
    Source: require('./source')(mongoose)
  };
};
