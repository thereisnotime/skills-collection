; TypeScript/TSX tree-sitter queries for codegraph
; Extends JavaScript patterns + interfaces, type aliases, enums

; --- Functions ---
(function_declaration) @definition.function
(generator_function_declaration) @definition.function

(lexical_declaration
  (variable_declarator
    value: (arrow_function))) @definition.function

(export_statement
  (function_declaration)) @definition.function

; --- Classes ---
(class_declaration) @definition.class

(export_statement
  (class_declaration)) @definition.class

; --- Interfaces & Types ---
(interface_declaration) @definition.class
(type_alias_declaration) @definition.class
(enum_declaration) @definition.class

(export_statement
  (interface_declaration)) @definition.class

(export_statement
  (type_alias_declaration)) @definition.class

(export_statement
  (enum_declaration)) @definition.class

; --- Methods ---
(method_definition) @definition.method
(public_field_definition) @definition.variable

; --- Variables (exported consts) ---
(export_statement
  (lexical_declaration)) @definition.variable

; --- Imports ---
(import_statement) @import

; --- Calls ---
(call_expression) @call

; --- References (read position) ---
(expression_statement (identifier) @reference.identifier)
(return_statement (identifier) @reference.identifier)
(assignment_expression right: (identifier) @reference.identifier)
(variable_declarator value: (identifier) @reference.identifier)
(arguments (identifier) @reference.identifier)
(binary_expression (identifier) @reference.identifier)
(array (identifier) @reference.identifier)
(spread_element (identifier) @reference.identifier)

; --- Type references ---
(type_annotation (type_identifier) @reference.type)
(generic_type name: (type_identifier) @reference.type)
(implements_clause (type_identifier) @reference.type)
(extends_clause value: (identifier) @reference.type)
(type_arguments (type_identifier) @reference.type)
