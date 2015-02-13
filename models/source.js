'use strict';

exports = module.exports = function(mongoose) {
  const sourceSchema = new mongoose.Schema({
    active: {
      type: Boolean,
      default: false
    },
    type: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true,
      index: true,
      unique: true
    },
    listref: {
      type: String
    },
    format: {
      type: String,
    },
    template: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    }
  });

  return mongoose.model('source', sourceSchema);
};
