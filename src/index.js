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

const Ajv = require('ajv');
const ajv = new Ajv();

const DatabaseService = require('polynode-service-mongodb');

const { buildModel, autoLoader } = require('polynode-supermodels-mongodb');

const RestAPIApplication = require('polynode-boilerplate-api-rest');

type TransformElement = {
  conditions: Array<Boolean>,
  transformer: (obj: Object) => Object,
};

type SecurityExecArguments = {
  deny?: Array<Boolean>,
  transforms?: Array<TransformElement>,
};

const {
  Errors: { ForbiddenError, UnprocessableEntityError },
} = require('polynode-boilerplate-webserver');

const enhancedControllerValidate = async function(validationSchema, obj) {
  console.log({}, 'Inside validateBody');
  const endpointValidator: EndpointValidatorType = ajv.compile(validationSchema);
  const verifiedData: any = await endpointValidator(obj);
  console.log({}, 'after endpointValidator, verifiedData is: ', verifiedData);
  return verifiedData;
};

//, controllerCallback: (context: {}, inputQuery: Object) => any
const getSchemaRegisterFunction = (subSchemaName: 'body' | 'query') => {
  return function(uncompiledJsonSchema) {
    console.log(
      '[getSchemaRegisterFunction] - uncompiledJsonSchema is: ',
      typeof uncompiledJsonSchema,
      typeof uncompiledJsonSchema === 'object' &&
        uncompiledJsonSchema.constructor &&
        uncompiledJsonSchema.constructor.name
    );
    return (query, body, context) => {
      return new Promise(async (resolve, reject) => {
        console.log('*** Resolving validator (' + subSchemaName + ')');
        if (!this.validationSchema) {
          this.validationSchema = {};
        }
        this.validationSchema[subSchemaName] = {
          ...uncompiledJsonSchema,
          $async: true,
          type: 'object',
        };
        try {
          console.log('starting validation');
          const result = [
            subSchemaName === 'query'
              ? await enhancedControllerValidate(
                  this.validationSchema[subSchemaName],
                  query._unsafe
                )
              : query,
            subSchemaName === 'body'
              ? await enhancedControllerValidate(this.validationSchema[subSchemaName], body._unsafe)
              : body,
            context,
          ];
          console.log('result is: ', result);
          return resolve(result);
        } catch (err) {
          console.log('-ERRR: ', err);
          // @todo: diferenciar entre errores de validacion y otro tipo de errores.
          if (err.constructor.name === 'ValidationError') {
            console.log({ err }, 'Validation errors:');
            return reject(
              new UnprocessableEntityError('Invalid query', {
                type: 'ValidationError',
                errors: err.errors,
              })
            );
          } else {
            console.log({ err }, 'Request error');
            return reject(err);
          }
        }
      });
    };
  };
};

const securityExec = ({ deny, transforms }: SecurityExecArguments) => {
  return async (query, body, context) => {
    console.log('deny: ', deny, 'transforms:', transforms);
    console.log('-> context  is: ', context);
    console.log('qbc is: ', query, body, context);
    console.log('securityContext: deny arr:', deny);
    const shouldDenyRequest = deny ? deny.filter(d => d === true).length : false;
    if (shouldDenyRequest) {
      console.log('securityContext: SHOULD DENY REQUEST!');
      throw new ForbiddenError();
    }

    const transformResult = async rawResult =>
      transforms
        .filter(tOp => tOp.conditions.filter(tc => tc === true).length > 0)
        .reduce((res, { transformer }) => transformer(res), rawResult);

    console.log('transforms:', transforms);
    return [query, body, context, transforms ? transformResult : null];
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
            securityExec,
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
