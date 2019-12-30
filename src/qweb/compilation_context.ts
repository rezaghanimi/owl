import { compileExpr, QWebVar } from "./expression_parser";

export const INTERP_REGEXP = /\{\{.*?\}\}/g;
//------------------------------------------------------------------------------
// Compilation Context
//------------------------------------------------------------------------------

export class CompilationContext {
  static nextID: number = 1;
  code: string[] = [];
  variables: { [key: string]: QWebVar } = {};
  escaping: boolean = false;
  parentNode: number | null | string = null;
  parentTextNode: number | null = null;
  rootNode: number | null = null;
  indentLevel: number = 0;
  rootContext: CompilationContext;
  shouldDefineParent: boolean = false;
  shouldDefineScope: boolean = false;
  shouldDefineQWeb: boolean = false;
  shouldDefineUtils: boolean = false;
  shouldDefineRefs: boolean = false;
  shouldDefineResult: boolean = true;
  loopNumber: number = 0;
  inPreTag: boolean = false;
  templateName: string;
  allowMultipleRoots: boolean = false;
  hasParentWidget: boolean = false;
  hasKey0: boolean = false;
  keyStack: boolean[] = [];
  subScopeID: null | number = null;

  constructor(name?: string) {
    this.rootContext = this;
    this.templateName = name || "noname";
    this.addLine("let h = this.h;");
  }

  generateID(): number {
    return CompilationContext.nextID++;
  }

  /**
   * This method generates a "template key", which is basically a unique key
   * which depends on the currently set keys, and on the iteration numbers (if
   * we are in a loop).
   *
   * Such a key is necessary when we need to associate an id to some element
   * generated by a template (for example, a component)
   */
  generateTemplateKey(prefix: string = ""): string {
    const id = this.generateID();
    if (this.loopNumber === 0 && !this.hasKey0) {
      return `'${prefix}__${id}__'`;
    }
    let key = `\`${prefix}__${id}__`;
    let start = this.hasKey0 ? 0 : 1;
    for (let i = start; i < this.loopNumber + 1; i++) {
      key += `\${key${i}}__`;
    }
    this.addLine(`let k${id} = ${key}\`;`);
    return `k${id}`;
  }

  generateCode(): string[] {
    if (this.shouldDefineResult) {
      this.code.unshift("    let result;");
    }

    if (this.shouldDefineScope) {
      this.code.unshift("    let scope = Object.create(context);");
    }
    if (this.shouldDefineRefs) {
      this.code.unshift("    context.__owl__.refs = context.__owl__.refs || {};");
    }
    if (this.shouldDefineParent) {
      if (this.hasParentWidget) {
        this.code.unshift("    let parent = extra.parent;");
      } else {
        this.code.unshift("    let parent = context;");
      }
    }
    if (this.shouldDefineQWeb) {
      this.code.unshift("    let QWeb = this.constructor;");
    }
    if (this.shouldDefineUtils) {
      this.code.unshift("    let utils = this.constructor.utils;");
    }
    return this.code;
  }

  withParent(node: number): CompilationContext {
    if (
      !this.allowMultipleRoots &&
      this === this.rootContext &&
      (this.parentNode || this.parentTextNode)
    ) {
      throw new Error("A template should not have more than one root node");
    }
    if (!this.rootContext.rootNode) {
      this.rootContext.rootNode = node;
    }
    if (!this.parentNode && this.rootContext.shouldDefineResult) {
      this.addLine(`result = vn${node};`);
    }
    return this.subContext("parentNode", node);
  }

  subContext(key: keyof CompilationContext, value: any): CompilationContext {
    const newContext = Object.create(this);
    newContext[key] = value;
    return newContext;
  }

  indent() {
    this.rootContext.indentLevel++;
  }

  dedent() {
    this.rootContext.indentLevel--;
  }

  addLine(line: string): number {
    const prefix = new Array(this.indentLevel + 2).join("    ");
    this.code.push(prefix + line);
    return this.code.length - 1;
  }

  addIf(condition: string) {
    this.addLine(`if (${condition}) {`);
    this.indent();
  }

  addElse() {
    this.dedent();
    this.addLine("} else {");
    this.indent();
  }

  closeIf() {
    this.dedent();
    this.addLine("}");
  }

  getValue(val: any): QWebVar | string {
    return val in this.variables ? this.getValue(this.variables[val]) : val;
  }

  /**
   * Prepare an expression for being consumed at render time.  Its main job
   * is to
   * - replace unknown variables by a lookup in the context
   * - replace already defined variables by their internal name
   */
  formatExpression(expr: string): string {
    this.rootContext.shouldDefineScope = true;
    const compiledScopeName = this.subScopeID ? `subScope_${this.subScopeID}` : `scope`;
    return compileExpr(expr, this.variables, compiledScopeName);
  }

  /**
   * Perform string interpolation on the given string. Note that if the whole
   * string is an expression, it simply returns it (formatted and enclosed in
   * parentheses).
   * For instance:
   *   'Hello {{x}}!' -> `Hello ${x}`
   *   '{{x ? 'a': 'b'}}' -> (x ? 'a' : 'b')
   */
  interpolate(s: string): string {
    let matches = s.match(INTERP_REGEXP);
    if (matches && matches[0].length === s.length) {
      return `(${this.formatExpression(s.slice(2, -2))})`;
    }

    let r = s.replace(/\{\{.*?\}\}/g, s => "${" + this.formatExpression(s.slice(2, -2)) + "}");
    return "`" + r + "`";
  }
  startProtectScope(): number {
    const protectID = this.generateID();
    this.rootContext.shouldDefineScope = true;
    this.addLine(`let _origScope${protectID} = scope;`);
    this.addLine(`scope = Object.assign(Object.create(context), scope);`);
    return protectID;
  }
  stopProtectScope(protectID: number) {
    this.addLine(`scope = _origScope${protectID};`);
  }
  /**
   * Similar in essence to startProtectScope
   * i.e. creates a subscope to not alter the original one
   * though this one should be uses in block of compiled code
   * e.g.: forEach loop
   */
  startBlockScope(): CompilationContext {
    this.rootContext.shouldDefineScope = true;
    const scopeID = this.generateID();
    const ctx = this.subContext('subScopeID', scopeID);
    ctx.addLine(`const subScope_${scopeID} = Object.assign(Object.create(context), scope);`);
    return ctx;
  }
}
