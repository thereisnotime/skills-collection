; JavaScript/JSX tree-sitter queries for codegraph
; Captures: definition.function, definition.class, definition.method,
;           definition.variable, import, call

; --- Functions ---
(function_declaration) @definition.function
(generator_function_declaration) @definition.function

; Arrow functions assigned to const/let/var
(lexical_declaration
  (variable_declarator
    value: (arrow_function))) @definition.function

; export function ...
(export_statement
  (function_declaration)) @definition.function

; --- Classes ---
(class_declaration) @definition.class

(export_statement
  (class_declaration)) @definition.class

; --- Methods ---
(method_definition) @definition.method

; --- Variables (exported consts) ---
(export_statement
  (lexical_declaration)) @definition.variable

; --- Imports ---
(import_statement) @import

; require() calls captured as imports too
(call_expression
  function: (identifier) @_req
  (#eq? @_req "require")) @import

; --- Calls ---
(call_expression) @call

; --- References (read position) ---
; Identifier used in expression (not declaration, not import, not call function position)
(expression_statement (identifier) @reference.identifier)
(return_statement (identifier) @reference.identifier)
(assignment_expression right: (identifier) @reference.identifier)
(variable_declarator value: (identifier) @reference.identifier)
(arguments (identifier) @reference.identifier)
(binary_expression (identifier) @reference.identifier)
(array (identifier) @reference.identifier)
(spread_element (identifier) @reference.identifier)
