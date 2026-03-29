; PHP tree-sitter queries for codegraph
; MVP: definitions + imports only, no call edges

; --- Functions ---
(function_definition) @definition.function

; --- Classes & Interfaces ---
(class_declaration) @definition.class
(interface_declaration) @definition.class
(trait_declaration) @definition.class
(enum_declaration) @definition.class

; --- Methods ---
(method_declaration) @definition.method

; --- Imports ---
(namespace_use_declaration) @import

; --- Calls ---
(function_call_expression) @call
(member_call_expression) @call
