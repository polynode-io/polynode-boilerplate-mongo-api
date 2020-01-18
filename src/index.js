/*
 * polynode-boilerplate-mongo-api
 *
 * Released under MIT license. Copyright 2019 Jorge Duarte Rodriguez <info@malagadev.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
 * to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies
 * or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 * FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 * $Id:$
 *
 * @flow
 * @format
 *
 */

const DatabaseService = require('polynode-service-mongodb');

const { buildModel, autoLoader } = require('polynode-supermodels-mongodb');

const RestAPIApplication = require('polynode-boilerplate-api-rest');

//, controllerCallback: (context: {}, inputQuery: Object) => any
const getSchemaRegisterFunction = function(subSchemaName: 'body' | 'query') {
  return function(uncompiledJsonSchema: {}) {
    if (!this.validationSchema) {
      this.validationSchema = {};
    }
    this.validationSchema[subSchemaName] = {
      ...uncompiledJsonSchema,
      $async: true,
      type: 'object',
    };
    return this;
  };
};

module.exports = {
  buildModel,
  injector: (composer, forwardOpts) => {
    const {
      webServerEnhanceContext,
      webServerRequestHooks,
      dbConfig,
      apiServiceConfig,
      ...restOfForwardOpts
    } = forwardOpts;

    return composer
      .integrate(RestAPIApplication, {
        enhanceRequestContext: function(getServerHandler) {
          webServerEnhanceContext.call(this);

          this.getModel = (modelName: string, getFull?: boolean = false): {} => {
            const fullModel = getServerHandler().getDepsContainer()[modelName + 'Model'];
            return getFull === true ? fullModel : fullModel.model;
          };

          this.getModels = (modelList: Array<string>): Array<{}> =>
            modelList.reduce((res, mName) => ({ ...res, [mName]: this.getModel(mName) }), {});
        },
        enhanceServerInstance: function() {
          this.registerEnhancedRouteHandlers({
            validateBody: getSchemaRegisterFunction('body'),
            validateQuery: getSchemaRegisterFunction('query'),
          });
        },
        webServerRequestHooks,
        apiServiceConfig,
        ...restOfForwardOpts,
      })
      .addStartHandler({
        app: ({ dependency }) => {
          console.log('[boilerplate-mongo-api] Start handler.');
          composer.container.resolve('app');
          composer.container.resolve('db');
        },
      })
      .registerDependency({
        db: inject => {
          console.log('registering db dep......');
          return inject
            .asClass(DatabaseService)
            .inject(() => ({
              config: dbConfig,
              onConnect: depsContainer =>
                autoLoader(() => composer.container, { config: apiServiceConfig }),
            }))
            .singleton();
        },
      });
  },
};
