import { parse } from 'acorn';

// TexTage publishes data as JS assignments/branches, not JSON. Interpret only
// this data language: never eval(), vm, import, or execute downloaded scripts.
export function readDataScript(source, initial = {}, stopAtHeader = false, stopAfter = '') {
  const env = Object.assign(Object.create(null), initial);
  let budget = 500000;
  const guard = () => { if (--budget < 0) throw new Error('譜面データが複雑すぎます'); };
  const keyOf = value => {
    const key = String(value);
    if (['__proto__', 'prototype', 'constructor'].includes(key) || key.length > 200) throw new Error('禁止されたデータキー');
    if (/^\d+$/.test(key) && Number(key) > 20000) throw new Error('データ範囲外');
    return key;
  };
  const ref = node => {
    if (node.type === 'Identifier') return [env, keyOf(node.name)];
    if (node.type === 'MemberExpression') {
      const object = value(node.object);
      if (!object || typeof object !== 'object') throw new Error('データ配列がありません');
      return [object, keyOf(node.computed ? value(node.property) : node.property.name)];
    }
    throw new Error('未対応の代入先');
  };
  const binary = (op, a, b) => {
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b;
      case '==': return a == b; case '!=': return a != b; case '===': return a === b; case '!==': return a !== b;
      case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
      case '&': return a & b; case '|': return a | b; case '^': return a ^ b; case '<<': return a << b; case '>>': return a >> b;
      default: throw new Error(`未対応の演算子: ${op}`);
    }
  };
  const value = node => {
    guard();
    switch (node.type) {
      case 'Literal': if (node.regex) throw new Error('正規表現はデータではありません'); return node.value;
      case 'Identifier': return env[keyOf(node.name)];
      case 'ArrayExpression': return node.elements.map(item => item ? value(item) : undefined);
      case 'ObjectExpression': {
        const result = Object.create(null);
        for (const item of node.properties) {
          if (item.type !== 'Property' || item.kind !== 'init' || item.method) throw new Error('未対応のデータ属性');
          result[keyOf(item.computed ? value(item.key) : item.key.name ?? item.key.value)] = value(item.value);
        }
        return result;
      }
      case 'MemberExpression': {
        const object = value(node.object), key = keyOf(node.computed ? value(node.property) : node.property.name);
        return object != null && Object.hasOwn(Object(object), key) ? object[key] : undefined;
      }
      case 'SequenceExpression': return node.expressions.reduce((_, item) => value(item), undefined);
      case 'ConditionalExpression': return value(node.test) ? value(node.consequent) : value(node.alternate);
      case 'LogicalExpression': return node.operator === '&&' ? value(node.left) && value(node.right) : value(node.left) || value(node.right);
      case 'BinaryExpression': return binary(node.operator, value(node.left), value(node.right));
      case 'UnaryExpression': {
        const v = value(node.argument);
        switch (node.operator) { case '!': return !v; case '-': return -v; case '+': return +v; case '~': return ~v; case 'void': return undefined; }
        throw new Error('未対応の単項演算');
      }
      case 'AssignmentExpression': {
        const [object, key] = ref(node.left), v = value(node.right);
        return object[key] = node.operator === '=' ? v : binary(node.operator.slice(0, -1), object[key], v);
      }
      case 'UpdateExpression': {
        const [object, key] = ref(node.argument), before = Number(object[key]);
        object[key] = before + (node.operator === '++' ? 1 : -1);
        return node.prefix ? object[key] : before;
      }
      case 'CallExpression': {
        // Legacy catalogue decorates titles with String.fontcolor(). Ignore
        // that presentation hint, without calling any downloaded function.
        if (node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.property.name === 'fontcolor') {
          const text = value(node.callee.object);
          if (typeof text === 'string') return text;
        }
        throw new Error('関数呼び出しを含むデータは読み込めません');
      }
      default: throw new Error(`未対応のデータ構文: ${node.type}`);
    }
  };
  const statement = node => {
    guard();
    switch (node.type) {
      case 'EmptyStatement': return;
      case 'ExpressionStatement': value(node.expression); return;
      case 'VariableDeclaration': for (const decl of node.declarations) { const [o, k] = ref(decl.id); o[k] = decl.init ? value(decl.init) : undefined; } return;
      case 'BlockStatement': for (const child of node.body) statement(child); return;
      case 'IfStatement': if (value(node.test)) statement(node.consequent); else if (node.alternate) statement(node.alternate); return;
      case 'ForStatement':
        if (node.init) node.init.type === 'VariableDeclaration' ? statement(node.init) : value(node.init);
        while (!node.test || value(node.test)) { guard(); statement(node.body); if (node.update) value(node.update); } return;
      default: throw new Error(`未対応のデータ文: ${node.type}`);
    }
  };
  for (const node of parse(source, { ecmaVersion: 'latest' }).body) {
    if (stopAtHeader && node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression.callee.name === 'hd') break;
    statement(node);
    if (stopAfter && Object.hasOwn(env, stopAfter)) break;
  }
  return env;
}
