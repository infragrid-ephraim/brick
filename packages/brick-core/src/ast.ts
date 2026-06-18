// AST node types for the Brick DSL

export type Location = {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
};

// ── Literals ────────────────────────────────────────────────────────────────

export type StringLiteral = { kind: "string"; value: string; location?: Location };
export type NumberLiteral = { kind: "number"; value: number; location?: Location };
export type BoolLiteral   = { kind: "bool"; value: boolean; location?: Location };
export type NullLiteral   = { kind: "null"; location?: Location };
export type ArrayLiteral  = { kind: "array"; elements: Expr[]; location?: Location };
export type ObjectLiteral = { kind: "object"; pairs: { key: string; value: Expr }[]; location?: Location };

export type Literal = StringLiteral | NumberLiteral | BoolLiteral | NullLiteral | ArrayLiteral | ObjectLiteral;

// ── Variable reference: @name ────────────────────────────────────────────────

export type VarRef  = { kind: "var";  name: string; location?: Location };
export type PropRef = { kind: "prop"; var: string; prop: string; location?: Location };

export type Expr = Literal | VarRef | PropRef;

// Condition expression (for if/while)
export type CondAtom = VarRef | PropRef | StringLiteral | NumberLiteral | BoolLiteral | NullLiteral;
export type CondExpr =
  | { kind: "compare"; op: string; left: CondAtom; right: CondAtom }
  | { kind: "not"; expr: CondAtom }
  | CondAtom;

// ── Type annotations ─────────────────────────────────────────────────────────

export type PrimitiveType = "String" | "Number" | "Boolean" | "Table" | "Any" | "Void";
export type TypeRef = { kind: "type_ref"; name: string };
export type ArrayType = { kind: "array_type"; element: TypeAnnotation };
export type TypeAnnotation = TypeRef | ArrayType;

// ── Type definitions: type Foo = { field: Type } ─────────────────────────────

export type TypeField = { name: string; type: TypeAnnotation };
export type TypeDef = {
  kind: "type_def";
  name: string;
  fields: TypeField[];
  location?: Location;
};

// Enum type: type Status = "pending" | "active" | "closed"
export type EnumTypeDef = {
  kind: "enum_def";
  name: string;
  variants: string[];
  location?: Location;
};

// ── Function parameter ───────────────────────────────────────────────────────

export type Param = { name: string; type: TypeAnnotation };

// ── Statements ───────────────────────────────────────────────────────────────

// go to "url" | @var
export type NavigateStmt = { kind: "navigate"; url: Expr; location?: Location };

// click "#selector" [as "Label"]
export type ClickStmt = { kind: "click"; selector: Expr; label?: string; location?: Location };

// fill "Field" with value
export type FillStmt = { kind: "fill"; field: Expr; value: Expr; variable?: string; location?: Location };

// type "#selector" with "text"
export type TypeStmt = { kind: "type_input"; selector: Expr; text: Expr; location?: Location };

// select "#selector" to "value"
export type SelectStmt = { kind: "select"; selector: Expr; value: Expr; location?: Location };

// press Enter | "ArrowDown"
export type PressStmt = { kind: "press"; key: string; location?: Location };

// wait 500ms | 2s
export type WaitStmt = { kind: "wait"; ms: number; location?: Location };

// scroll "#selector" by 300
export type ScrollStmt = { kind: "scroll"; selector: Expr; deltaY: number; location?: Location };

// screenshot [-> @var]
export type ScreenshotStmt = { kind: "screenshot"; variable?: string; location?: Location };

// ai "instruction" [-> @var]
export type AiStmt = { kind: "ai"; instruction: string; variable?: string; location?: Location };

// extract_table "description" [as Type] -> @var
export type ExtractTableStmt = { kind: "extract_table"; description: string; outputType?: TypeAnnotation; variable: string; location?: Location };

// @var = value  |  value -> @var
export type SetVarStmt = { kind: "set_var"; variable: string; value: Expr; location?: Location };

// save @var as "name"
export type SaveTableStmt = { kind: "save_table"; variable: string; name: string; location?: Location };

// extract from @var "query" -> @result
export type ExtractStmt = { kind: "extract"; source: string; query: string; variable: string; location?: Location };

// js { code } [-> @var]
export type JsBlockStmt = { kind: "js_block"; code: string; variable?: string; location?: Location };

// python { code } [-> @var]
export type PyBlockStmt = { kind: "py_block"; code: string; variable?: string; location?: Location };

// load excel @file sheet "Sheet1" -> @var
export type LoadExcelStmt = { kind: "load_excel"; file: Expr; sheet: string; variable: string; location?: Location };

// upload @file to "#selector" [-> @var]
export type UploadFileStmt = { kind: "upload_file"; file: Expr; selector: Expr; variable?: string; location?: Location };

// report title: "name" { jsx }
export type ReportStmt = { kind: "report"; title: Expr; content: string; location?: Location };

// return @var | value
export type ReturnStmt = { kind: "return"; value: Expr; location?: Location };

// gen "prompt" [as Type] [using "model"] -> @var
export type GenStmt         = { kind: "gen";          prompt: string; outputType?: TypeAnnotation; model?: string; variable?: string; location?: Location };
// gen_code "prompt" [as Type] [using "model"] -> @var
export type GenCodeStmt     = { kind: "gen_code";     prompt: string; outputType?: TypeAnnotation; model?: string; variable?: string; location?: Location };
// set_cookies @var | "[{...}]"
export type SetCookiesStmt  = { kind: "set_cookies";  cookies: Expr; location?: Location };
// load_excel_all "url" -> @sheets
export type LoadExcelAllStmt = { kind: "load_excel_all"; source: Expr; variable: string; location?: Location };

// read_pdf "url" -> @text
export type ReadPdfStmt      = { kind: "read_pdf";       source: Expr; variable: string; location?: Location };
// read_pdf_pages "url" -> @pages  (returns String[])
export type ReadPdfPagesStmt = { kind: "read_pdf_pages"; source: Expr; variable: string; location?: Location };
// ocr "url" -> @text
export type OcrImageStmt  = { kind: "ocr_image";  source: Expr; variable: string; location?: Location };
// read_file "url" [as "filename"] -> @text
export type ReadFileStmt  = { kind: "read_file";  source: Expr; filename?: string; variable: string; location?: Location };
// read_gdoc "https://docs.google.com/..." -> @text
export type ReadGdocStmt  = { kind: "read_gdoc";  url: Expr; variable: string; location?: Location };

// Control flow
export type IfStmt          = { kind: "if";              condition: CondExpr; then: Stmt[]; else: Stmt[]; location?: Location };
export type ForEachStmt     = { kind: "for_each";        variable: string; collection: Expr; body: Stmt[]; location?: Location };
export type RepeatStmt      = { kind: "repeat";          count: number; body: Stmt[]; location?: Location };
export type WhileStmt       = { kind: "while";           condition: CondExpr; body: Stmt[]; location?: Location };
export type BreakStmt       = { kind: "break";           location?: Location };
export type ContinueStmt    = { kind: "continue";        location?: Location };
export type LogStmt         = { kind: "log";             value: Expr; location?: Location };
export type FailStmt        = { kind: "fail";            message: string; location?: Location };
export type CompoundAssign  = { kind: "compound_assign"; variable: string; op: string; value: Expr; location?: Location };

export type Stmt =
  | NavigateStmt
  | ClickStmt
  | FillStmt
  | TypeStmt
  | SelectStmt
  | PressStmt
  | WaitStmt
  | ScrollStmt
  | ScreenshotStmt
  | AiStmt
  | ExtractTableStmt
  | SetVarStmt
  | SaveTableStmt
  | ExtractStmt
  | JsBlockStmt
  | PyBlockStmt
  | LoadExcelStmt
  | UploadFileStmt
  | ReportStmt
  | ReturnStmt
  | GenStmt
  | GenCodeStmt
  | SetCookiesStmt
  | LoadExcelAllStmt
  | ReadPdfStmt
  | ReadPdfPagesStmt
  | OcrImageStmt
  | ReadFileStmt
  | ReadGdocStmt
  | IfStmt
  | ForEachStmt
  | RepeatStmt
  | WhileStmt
  | BreakStmt
  | ContinueStmt
  | LogStmt
  | FailStmt
  | CompoundAssign;

// ── Top-level declarations ───────────────────────────────────────────────────

// value -> @variable  (module-level)
export type TopLevelVar = { kind: "top_level_var"; variable: string; value: Expr; location?: Location };

// main(params) [-> ReturnType] { stmts }
export type FunctionDef = {
  kind: "function_def";
  name: string;
  params: Param[];
  returnType?: TypeAnnotation;
  body: Stmt[];
  location?: Location;
};

// import "path.brick"
export type ImportDecl = { kind: "import"; path: string; location?: Location };
// module Name
export type ModuleDecl = { kind: "module_decl"; name: string; location?: Location };

export type TopLevel = ModuleDecl | ImportDecl | TypeDef | EnumTypeDef | TopLevelVar | FunctionDef;

// ── Root ─────────────────────────────────────────────────────────────────────

export type BrickFile = {
  kind: "brick_file";
  declarations: TopLevel[];
};
