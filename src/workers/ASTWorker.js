const { default: astTraverse } = require('@babel/traverse');

/*
 * Get list of all variables that are associated with module, that was imported by require() usage
 *
 * Returns object { variables: [{ name, type }], requires }
 */
const findAllVariablesForRequiredModule = (ast, moduleName) => {
  const variables = [];
  const requires = [];

  astTraverse(ast, {
    CallExpression: (path) => {
      const { node, container } = path;
      const args = node.arguments;
      if (node.callee.name !== 'require' || args.length !== 1 || args[0].type !== 'StringLiteral') {
        return;
      }

      const requiredPath = args[0].value;
      const requiredPathParts = requiredPath.split('/');
      if (requiredPathParts[0] !== moduleName) {
        return;
      }

      requires.push(requiredPath);

      // actual clients are placed on the root of module, so path should be 'motorway-api-client/some-client'
      if (requiredPathParts.length > 2) {
        return;
      }

      if (container.type !== 'VariableDeclarator') {
        throw Error('Unknown way to require api-client');
      }

      const variable = container.id;
      switch (variable.type) {
        case 'Identifier':
          variables.push({ name: variable.name, type: 'module' });
          break;
        case 'ObjectPattern': {
          const propertyNode = variable.properties[0];
          if (variable.properties.length !== 1 || propertyNode.type !== 'ObjectProperty') {
            throw Error('Unknown way to require api-client');
          }
          const propertyVariable = propertyNode.value;
          if (propertyVariable.type !== 'Identifier') {
            throw Error('Unknown way to require api-client');
          }

          variables.push({ name: propertyVariable.name, type: 'method' });
          break;
        }
        default:
          throw Error('Unknown way to require api-client');
      }
    },
  });

  return { variables, requires };
};

module.exports = {
  findAllVariablesForRequiredModule,
};
