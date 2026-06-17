{{
  // Module-level code (runs once when grammar is loaded)
}}

{
  // Per-parse initializer
  function loc() { return options.includeLocations ? location() : undefined; }
  function unescapeString(s) { return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
  function parseDuration(n, unit) {
    if (unit === 'ms') return n;
    if (unit === 's')  return n * 1000;
    if (unit === 'm')  return n * 60000;
    return n;
  }
}

// ── Root ─────────────────────────────────────────────────────────────────────

BrickFile
  = _ decls:TopLevel* _
  { return { kind: "brick_file", declarations: decls }; }

TopLevel
  = ModuleDecl
  / TypeDef
  / FunctionDef
  / TopLevelVar

// ── Module declaration ────────────────────────────────────────────────────────

ModuleDecl
  = "module" _ name:Identifier _
  { return { kind: "module_decl", name, location: loc() }; }

// ── Type definitions ──────────────────────────────────────────────────────────

TypeDef
  = "type" _ name:Identifier _ "=" _ "{" _ fields:TypeField* _ "}" _
  { return { kind: "type_def", name, fields, location: loc() }; }

TypeField
  = name:Identifier _ ":" _ type:TypeAnnotation _ ","? _
  { return { name, type }; }

TypeAnnotation
  = base:Identifier "[" _ "]" { return { kind: "array_type", element: { kind: "type_ref", name: base } }; }
  / name:Identifier           { return { kind: "type_ref", name }; }

// ── Top-level variable: value -> @name ───────────────────────────────────────

TopLevelVar
  = value:Expr _ "->" _ "@" name:Identifier _
  { return { kind: "top_level_var", variable: name, value, location: loc() }; }

// ── Function definition ───────────────────────────────────────────────────────

FunctionDef
  = name:Identifier _ "(" _ params:ParamList _ ")" _ ret:ReturnType? _ "{" _ body:Stmt* _ "}" _
  { return { kind: "function_def", name, params: params || [], returnType: ret || undefined, body, location: loc() }; }

ParamList
  = first:Param rest:(_ "," _ p:Param { return p; })* { return [first, ...rest]; }
  / ""  { return []; }

Param
  = name:Identifier _ ":" _ type:TypeAnnotation
  { return { name, type }; }

ReturnType
  = "->" _ type:TypeAnnotation { return type; }

// ── Statements ────────────────────────────────────────────────────────────────

Stmt
  = NavigateStmt
  / ClickStmt
  / FillStmt
  / TypeStmt
  / SelectStmt
  / PressStmt
  / WaitStmt
  / ScrollStmt
  / ScreenshotStmt
  / AiStmt
  / ExtractTableStmt
  / ExtractStmt
  / SetVarAssignStmt
  / SetVarArrowStmt
  / SaveTableStmt
  / JsBlockStmt
  / PyBlockStmt
  / LoadExcelStmt
  / UploadFileStmt
  / ReportStmt
  / ReturnStmt

// navigate <url>  (also accepts legacy: go to <url>)
NavigateStmt
  = "navigate" _ url:Expr _
  { return { kind: "navigate", url, location: loc() }; }
  / "go" _ "to" _ url:Expr _
  { return { kind: "navigate", url, location: loc() }; }

// click <selector> [as "Label"]
ClickStmt
  = "click" _ selector:Expr label:(_ "as" _ s:StringLit { return s; })? _
  { return { kind: "click", selector, label: label || undefined, location: loc() }; }

// fill <field> with <value> [-> @var]
FillStmt
  = "fill" _ field:Expr _ "with" _ value:Expr variable:(_ "->" _ "@" n:Identifier { return n; })? _
  { return { kind: "fill", field, value, variable: variable || undefined, location: loc() }; }

// type <selector> with <text>
TypeStmt
  = "type" _ selector:Expr _ "with" _ text:Expr _
  { return { kind: "type_input", selector, text, location: loc() }; }

// select <selector> to <value>
SelectStmt
  = "select" _ selector:Expr _ "to" _ value:Expr _
  { return { kind: "select", selector, value, location: loc() }; }

// press <key>
PressStmt
  = "press" _ key:(StringLit / BareKey) _
  { return { kind: "press", key, location: loc() }; }

BareKey
  = chars:[A-Za-z0-9]+ { return chars.join(""); }

// wait <n><unit>
WaitStmt
  = "wait" _ n:Number unit:TimeUnit? _
  { return { kind: "wait", ms: parseDuration(n, unit ?? "ms"), location: loc() }; }

TimeUnit
  = "ms" / "s" / "m"

// scroll <selector> by <n>
ScrollStmt
  = "scroll" _ selector:Expr _ "by" _ n:Number _
  { return { kind: "scroll", selector, deltaY: n, location: loc() }; }

// screenshot [-> @var]
ScreenshotStmt
  = "screenshot" variable:(_ "->" _ "@" n:Identifier { return n; })? _
  { return { kind: "screenshot", variable: variable || undefined, location: loc() }; }

// ai "instruction" [-> @var]
AiStmt
  = "ai" _ instruction:StringLit variable:(_ "->" _ "@" n:Identifier { return n; })? _
  { return { kind: "ai", instruction, variable: variable || undefined, location: loc() }; }

// extract table "description" -> @var
ExtractTableStmt
  = "extract" _ "table" _ description:StringLit _ "->" _ "@" variable:Identifier _
  { return { kind: "extract_table", description, variable, location: loc() }; }

// extract from @var "query" -> @result
ExtractStmt
  = "extract" _ "from" _ "@" source:Identifier _ query:StringLit _ "->" _ "@" variable:Identifier _
  { return { kind: "extract", source, query, variable, location: loc() }; }

// @var = value
SetVarAssignStmt
  = "@" variable:Identifier _ "=" _ value:Expr _
  { return { kind: "set_var", variable, value, location: loc() }; }

// value -> @var
SetVarArrowStmt
  = value:Expr _ "->" _ "@" variable:Identifier _
  { return { kind: "set_var", variable, value, location: loc() }; }

// save @var as "name"
SaveTableStmt
  = "save" _ "@" variable:Identifier _ "as" _ name:StringLit _
  { return { kind: "save_table", variable, name, location: loc() }; }

// js { code } [-> @var]
JsBlockStmt
  = "js" _ "{" code:BlockCode "}" variable:(_ "->" _ "@" n:Identifier { return n; })? _
  { return { kind: "js_block", code: code.trim(), variable: variable || undefined, location: loc() }; }

// python { code } [-> @var]
PyBlockStmt
  = "python" _ "{" code:BlockCode "}" variable:(_ "->" _ "@" n:Identifier { return n; })? _
  { return { kind: "py_block", code: code.trim(), variable: variable || undefined, location: loc() }; }

// Captures everything between { } that may contain nested { }
BlockCode
  = chars:BlockChar* { return chars.join(""); }

BlockChar
  = !("}" [^{]*) c:. { return c; }
  / "{" inner:BlockCode "}" { return "{" + inner + "}"; }

// load excel <file> sheet "Sheet1" -> @var
LoadExcelStmt
  = "load" _ "excel" _ file:Expr _ "sheet" _ sheet:StringLit _ "->" _ "@" variable:Identifier _
  { return { kind: "load_excel", file, sheet, variable, location: loc() }; }

// upload <file> to <selector> [-> @var]
UploadFileStmt
  = "upload" _ file:Expr _ "to" _ selector:Expr variable:(_ "->" _ "@" n:Identifier { return n; })? _
  { return { kind: "upload_file", file, selector, variable: variable || undefined, location: loc() }; }

// report title: <value> { jsx }
ReportStmt
  = "report" _ "title" _ ":" _ title:Expr _ "{" content:BlockCode "}" _
  { return { kind: "report", title, content: content.trim(), location: loc() }; }

// return <value>
ReturnStmt
  = "return" _ value:Expr _
  { return { kind: "return", value, location: loc() }; }

// ── Expressions ──────────────────────────────────────────────────────────────

Expr
  = ObjectExpr
  / ArrayExpr
  / VarRef
  / StringExpr
  / NumberExpr
  / BoolExpr
  / NullExpr

VarRef
  = "@" name:Identifier { return { kind: "var", name }; }

StringExpr
  = s:StringLit { return { kind: "string", value: s }; }

NumberExpr
  = n:Number { return { kind: "number", value: n }; }

BoolExpr
  = "true"  { return { kind: "bool", value: true }; }
  / "false" { return { kind: "bool", value: false }; }

NullExpr
  = "null" { return { kind: "null" }; }

ArrayExpr
  = "[" _ elements:ExprList _ "]"
  { return { kind: "array", elements }; }

ExprList
  = first:Expr rest:(_ "," _ e:Expr { return e; })* { return [first, ...rest]; }
  / ""  { return []; }

ObjectExpr
  = "{" _ pairs:PairList _ "}"
  { return { kind: "object", pairs }; }

PairList
  = first:Pair rest:(_ "," _ p:Pair { return p; })* { return [first, ...rest]; }
  / ""  { return []; }

Pair
  = key:(StringLit / Identifier) _ ":" _ value:Expr
  { return { key, value }; }

// ── Primitives ───────────────────────────────────────────────────────────────

StringLit
  = '"' chars:DoubleStringChar* '"' { return unescapeString(chars.join("")); }
  / "'" chars:SingleStringChar* "'" { return unescapeString(chars.join("")); }

DoubleStringChar
  = '\\' c:. { return "\\" + c; }
  / [^"\\]

SingleStringChar
  = '\\' c:. { return "\\" + c; }
  / [^'\\]

Number
  = digits:[0-9]+ frac:("." [0-9]+)?
  { return parseFloat(digits.join("") + (frac ? "." + frac[1].join("") : "")); }

Identifier
  = first:[A-Za-z_] rest:[A-Za-z0-9_]*
  { return first + rest.join(""); }

// ── Whitespace & comments ─────────────────────────────────────────────────────

_  = (Whitespace / Comment)*

Whitespace = [ \t\n\r]+

Comment
  = "//" (![\n] .)* [\n]?
