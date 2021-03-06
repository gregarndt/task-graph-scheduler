module.exports = {
  scheduler: {
    schedulerId:                  'task-graph-scheduler',

    taskGraphTableName:           'TaskGraphs',

    exchangePrefix:               'v1/',

    listenerQueueName:            'task-graph-scheduler/event-queue'
  },

  pulse: {
    username:                       'taskcluster-scheduler',
    // Provided by environment variable
    password:                       undefined
  },

  server: {
    publicUrl:                      'https://scheduler.taskcluster.net',
    port:                           80,
    env:                            'production',
    forceSSL:                       true,
    // We trust the proxy on heroku, as the SSL end-point provided by heroku
    // is a proxy, so we have to trust it.
    trustProxy:                     true
  }
};
