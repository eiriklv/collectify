exports = module.exports = function(mongoose) {
  var sourceSchema = new mongoose.Schema({
    active: {
      type: Boolean,
      default: false
    },
    origin: {
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
    linkref: {
      type: String
    },
    tags: {
      type: Array,
      required: true
    },
    format: {
      type: String,
      required: true
    },
    body: {
      type: Boolean,
      default: false
    },
    template: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    }
  });
  // create the model for articles and return it
  return mongoose.model('source', sourceSchema);
};
