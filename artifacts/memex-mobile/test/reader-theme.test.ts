import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('article and infobox cell HTML renderers inherit the active article text color', () => {
  const source = ts.createSourceFile('OfflineReader.tsx',
    readFileSync(new URL('../components/OfflineReader.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let renderers = 0;
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === 'RenderHtml') {
      renderers++;
      const baseStyle = node.attributes.properties.find(property =>
        ts.isJsxAttribute(property) && property.name.getText(source) === 'baseStyle');
      assert.ok(baseStyle && ts.isJsxAttribute(baseStyle), 'Every HTML boundary needs its own theme color');
      const initializer = baseStyle.initializer;
      assert.ok(initializer && ts.isJsxExpression(initializer) && initializer.expression);
      const expression = ts.isAsExpression(initializer.expression)
        ? initializer.expression.expression : initializer.expression;
      assert.equal(expression.getText(source), '{ color: colors.foreground }');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(renderers, 2, 'Check both article blocks and separately rendered table/infobox cells');
});
