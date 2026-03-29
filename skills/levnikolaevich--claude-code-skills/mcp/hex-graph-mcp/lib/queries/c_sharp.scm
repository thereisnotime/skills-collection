; C# tree-sitter queries for codegraph
; MVP: definitions + imports only, no call edges

; --- Classes & Interfaces ---
(class_declaration) @definition.class
(interface_declaration) @definition.class
(struct_declaration) @definition.class
(enum_declaration) @definition.class
(record_declaration) @definition.class

; --- Methods ---
(method_declaration) @definition.method
(constructor_declaration) @definition.method

; --- Properties ---
(property_declaration) @definition.variable

; --- Imports ---
(using_directive) @import

; --- Calls ---
(invocation_expression) @call
