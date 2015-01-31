var util = require('util');

exports = module.exports = function(logger, name) {
  return function(value) {
    logger(name, util.inspect(value, {
      colors: true
    }));
  };
};
