const { default: astTraverse } = require('@babel/traverse');

/*
 * Process module require
 *
 * Returns description of variable, initialized on require() in format { type: 'object' || 'fn', name }
 */
const processModuleRequire = (node, container, moduleNameChecker) => {
  const args = node.arguments;
  if (args.length !== 1 || args[0].type !== 'StringLiteral') {
    return null;
  }

  const requirePath = args[0].value;
  if (!moduleNameChecker(requirePath)) {
    return null;
  }

  if (container.type !== 'VariableDeclarator') {
    throw Error('Unknown way to require module');
  }

  const variable = container.id;

  // const apiClient = require();
  if (variable.type === 'Identifier') {
    return { name: variable.name, type: 'object', module: requirePath };
  }

  // const { getUsers } = require();
  if (variable.type === 'ObjectPattern') {
    const propertyNode = variable.properties[0];
    if (variable.properties.length !== 1 || propertyNode.type !== 'ObjectProperty') {
      throw Error('Unknown way to require module');
    }

    const propertyVariable = propertyNode.value;
    if (propertyVariable.type !== 'Identifier') {
      throw Error('Unknown way to require module');
    }

    return { name: propertyVariable.name, type: 'fn', module: requirePath };
  }

  throw Error('Unknown way to require module');
};

/*
 * Process module method assignment to variable as object property
 */
const processObjectInitializationWithModuleMethod = (path) => {
  const { parentPath } = path;

  // single object property `foo: 1`
  if (parentPath.parent.type !== 'ObjectProperty') {
    return null;
  }

  // object expression `{ foo: 1, bar: 2 }`
  if (parentPath.parentPath.parentPath.type !== 'ObjectExpression') {
    return null;
  }

  // variable declaration expression `const obj = { foo: 1, bar: 2 }`
  const declarationPath = parentPath.parentPath.parentPath.parentPath;
  if (declarationPath.type !== 'VariableDeclarator') {
    return null;
  }

  const variable = declarationPath.node.id;
  if (variable.type !== 'Identifier') {
    return null;
  }

  return { name: variable.name, type: 'object', module: path.node.name };
};

/*
 * Get list of all calls for module methods
 *
 * "moduleNameChecker" is function that would be called for every require() to determine if we are interested for that
 *   module or not
 */
const findAllUsageForModuleMethods = (ast, moduleNameChecker) => {
  const variables = new Map();
  const calls = [];
  const mentions = [];

  astTraverse(ast, {
    Identifier: (path) => {
      const { node, parentPath } = path;
      const variable = variables.get(node.name);
      if (!variable) {
        return;
      }

      if (path.key === 'callee' || parentPath.key === 'callee') {
        mentions.push({ type: 'call', name: node.name });
        return;
      }

      // const obj = { someProp: __apiMethod__ }
      if (parentPath.key === 'value') {
        const newVariable = processObjectInitializationWithModuleMethod(path);
        if (newVariable) {
          const { name } = newVariable;
          const existing = variables.get(name);
          variables.set(name, { ...newVariable, ...(existing?.name !== name && { module: 'Vary' }) });
          mentions.push({ type: 'assignment', name: node.name });
          return;
        }
      }

      mentions.push({ type: 'unknown', name: node.name, position: node.loc.start });
    },
    CallExpression: ({ node, container }) => {
      const { callee } = node;

      if (callee.name === 'require') {
        const variable = processModuleRequire(node, container, moduleNameChecker);
        if (variable) {
          variables.set(variable.name, variable);
        }
        return;
      }

      // regular method call, like `getUsers({})`
      if (callee.type === 'Identifier') {
        const variable = variables.get(callee.name);
        if (variable) {
          calls.push({
            module: variable.module,
            method: variable.name,
            args: node.arguments,
            position: node.loc.start,
          });
        }
        return;
      }

      // method calls, using module, like `usersClient.getUsers({})`
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') {
        const variable = variables.get(callee.object.name);
        if (variable && callee.property.type === 'Identifier') {
          calls.push({
            module: variable.module,
            method: callee.property.name,
            args: node.arguments,
            position: node.loc.start,
          });
        }
      }
    },
  });

  return { calls, mentions };
};

module.exports = {
  findAllUsageForModuleMethods,
};
