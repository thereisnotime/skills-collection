// An index contains one or more pieces of information about a given piece of
// source code or software artifact. Complementary information can be merged
// together from multiple sources to provide a unified code intelligence
// experience.
//
// Programs producing a file of this format is an "indexer" and may operate
// somewhere on the spectrum between precision, such as indexes produced by
// compiler-backed indexers, and heurstics, such as indexes produced by local
// syntax-directed analysis for scope rules.
import { enumDesc, fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
/**
 * Describes the file scip.proto.
 */
export const file_scip = /*@__PURE__*/ fileDesc("CgpzY2lwLnByb3RvEgRzY2lwIn8KBUluZGV4EiAKCG1ldGFkYXRhGAEgASgLMg4uc2NpcC5NZXRhZGF0YRIhCglkb2N1bWVudHMYAiADKAsyDi5zY2lwLkRvY3VtZW50EjEKEGV4dGVybmFsX3N5bWJvbHMYAyADKAsyFy5zY2lwLlN5bWJvbEluZm9ybWF0aW9uIp8BCghNZXRhZGF0YRImCgd2ZXJzaW9uGAEgASgOMhUuc2NpcC5Qcm90b2NvbFZlcnNpb24SIQoJdG9vbF9pbmZvGAIgASgLMg4uc2NpcC5Ub29sSW5mbxIUCgxwcm9qZWN0X3Jvb3QYAyABKAkSMgoWdGV4dF9kb2N1bWVudF9lbmNvZGluZxgEIAEoDjISLnNjaXAuVGV4dEVuY29kaW5nIjwKCFRvb2xJbmZvEgwKBG5hbWUYASABKAkSDwoHdmVyc2lvbhgCIAEoCRIRCglhcmd1bWVudHMYAyADKAkixQEKCERvY3VtZW50EhAKCGxhbmd1YWdlGAQgASgJEhUKDXJlbGF0aXZlX3BhdGgYASABKAkSJQoLb2NjdXJyZW5jZXMYAiADKAsyEC5zY2lwLk9jY3VycmVuY2USKAoHc3ltYm9scxgDIAMoCzIXLnNjaXAuU3ltYm9sSW5mb3JtYXRpb24SDAoEdGV4dBgFIAEoCRIxChFwb3NpdGlvbl9lbmNvZGluZxgGIAEoDjIWLnNjaXAuUG9zaXRpb25FbmNvZGluZyJfCgZTeW1ib2wSDgoGc2NoZW1lGAEgASgJEh4KB3BhY2thZ2UYAiABKAsyDS5zY2lwLlBhY2thZ2USJQoLZGVzY3JpcHRvcnMYAyADKAsyEC5zY2lwLkRlc2NyaXB0b3IiOQoHUGFja2FnZRIPCgdtYW5hZ2VyGAEgASgJEgwKBG5hbWUYAiABKAkSDwoHdmVyc2lvbhgDIAEoCSKCAgoKRGVzY3JpcHRvchIMCgRuYW1lGAEgASgJEhUKDWRpc2FtYmlndWF0b3IYAiABKAkSJwoGc3VmZml4GAMgASgOMhcuc2NpcC5EZXNjcmlwdG9yLlN1ZmZpeCKlAQoGU3VmZml4EhUKEVVuc3BlY2lmaWVkU3VmZml4EAASDQoJTmFtZXNwYWNlEAESDwoHUGFja2FnZRABGgIIARIICgRUeXBlEAISCAoEVGVybRADEgoKBk1ldGhvZBAEEhEKDVR5cGVQYXJhbWV0ZXIQBRINCglQYXJhbWV0ZXIQBhIICgRNZXRhEAcSCQoFTG9jYWwQCBIJCgVNYWNybxAJGgIQASLwCwoRU3ltYm9sSW5mb3JtYXRpb24SDgoGc3ltYm9sGAEgASgJEhUKDWRvY3VtZW50YXRpb24YAyADKAkSKQoNcmVsYXRpb25zaGlwcxgEIAMoCzISLnNjaXAuUmVsYXRpb25zaGlwEioKBGtpbmQYBSABKA4yHC5zY2lwLlN5bWJvbEluZm9ybWF0aW9uLktpbmQSFAoMZGlzcGxheV9uYW1lGAYgASgJEi8KF3NpZ25hdHVyZV9kb2N1bWVudGF0aW9uGAcgASgLMg4uc2NpcC5Eb2N1bWVudBIYChBlbmNsb3Npbmdfc3ltYm9sGAggASgJIvsJCgRLaW5kEhMKD1Vuc3BlY2lmaWVkS2luZBAAEhIKDkFic3RyYWN0TWV0aG9kEEISDAoIQWNjZXNzb3IQSBIJCgVBcnJheRABEg0KCUFzc2VydGlvbhACEhIKDkFzc29jaWF0ZWRUeXBlEAMSDQoJQXR0cmlidXRlEAQSCQoFQXhpb20QBRILCgdCb29sZWFuEAYSCQoFQ2xhc3MQBxILCgdDb25jZXB0EFYSDAoIQ29uc3RhbnQQCBIPCgtDb25zdHJ1Y3RvchAJEgwKCENvbnRyYWN0ED4SDgoKRGF0YUZhbWlseRAKEgwKCERlbGVnYXRlEEkSCAoERW51bRALEg4KCkVudW1NZW1iZXIQDBIJCgVFcnJvchA/EgkKBUV2ZW50EA0SDQoJRXh0ZW5zaW9uEFQSCAoERmFjdBAOEgkKBUZpZWxkEA8SCAoERmlsZRAQEgwKCEZ1bmN0aW9uEBESCgoGR2V0dGVyEBISCwoHR3JhbW1hchATEgwKCEluc3RhbmNlEBQSDQoJSW50ZXJmYWNlEBUSBwoDS2V5EBYSCAoETGFuZxAXEgkKBUxlbW1hEBgSCwoHTGlicmFyeRBAEgkKBU1hY3JvEBkSCgoGTWV0aG9kEBoSDwoLTWV0aG9kQWxpYXMQShISCg5NZXRob2RSZWNlaXZlchAbEhcKE01ldGhvZFNwZWNpZmljYXRpb24QQxILCgdNZXNzYWdlEBwSCQoFTWl4aW4QVRIMCghNb2RpZmllchBBEgoKBk1vZHVsZRAdEg0KCU5hbWVzcGFjZRAeEggKBE51bGwQHxIKCgZOdW1iZXIQIBIKCgZPYmplY3QQIRIMCghPcGVyYXRvchAiEgsKB1BhY2thZ2UQIxIRCg1QYWNrYWdlT2JqZWN0ECQSDQoJUGFyYW1ldGVyECUSEgoOUGFyYW1ldGVyTGFiZWwQJhILCgdQYXR0ZXJuECcSDQoJUHJlZGljYXRlECgSDAoIUHJvcGVydHkQKRIMCghQcm90b2NvbBAqEhIKDlByb3RvY29sTWV0aG9kEEQSFQoRUHVyZVZpcnR1YWxNZXRob2QQRRIPCgtRdWFzaXF1b3RlchArEhEKDVNlbGZQYXJhbWV0ZXIQLBIKCgZTZXR0ZXIQLRINCglTaWduYXR1cmUQLhISCg5TaW5nbGV0b25DbGFzcxBLEhMKD1NpbmdsZXRvbk1ldGhvZBBMEhQKEFN0YXRpY0RhdGFNZW1iZXIQTRIPCgtTdGF0aWNFdmVudBBOEg8KC1N0YXRpY0ZpZWxkEE8SEAoMU3RhdGljTWV0aG9kEFASEgoOU3RhdGljUHJvcGVydHkQURISCg5TdGF0aWNWYXJpYWJsZRBSEgoKBlN0cmluZxAwEgoKBlN0cnVjdBAxEg0KCVN1YnNjcmlwdBAvEgoKBlRhY3RpYxAyEgsKB1RoZW9yZW0QMxIRCg1UaGlzUGFyYW1ldGVyEDQSCQoFVHJhaXQQNRIPCgtUcmFpdE1ldGhvZBBGEggKBFR5cGUQNhINCglUeXBlQWxpYXMQNxINCglUeXBlQ2xhc3MQOBITCg9UeXBlQ2xhc3NNZXRob2QQRxIOCgpUeXBlRmFtaWx5EDkSEQoNVHlwZVBhcmFtZXRlchA6EgkKBVVuaW9uEDsSCQoFVmFsdWUQPBIMCghWYXJpYWJsZRA9IoIBCgxSZWxhdGlvbnNoaXASDgoGc3ltYm9sGAEgASgJEhQKDGlzX3JlZmVyZW5jZRgCIAEoCBIZChFpc19pbXBsZW1lbnRhdGlvbhgDIAEoCBIaChJpc190eXBlX2RlZmluaXRpb24YBCABKAgSFQoNaXNfZGVmaW5pdGlvbhgFIAEoCCLIAQoKT2NjdXJyZW5jZRINCgVyYW5nZRgBIAMoBRIOCgZzeW1ib2wYAiABKAkSFAoMc3ltYm9sX3JvbGVzGAMgASgFEh4KFm92ZXJyaWRlX2RvY3VtZW50YXRpb24YBCADKAkSJQoLc3ludGF4X2tpbmQYBSABKA4yEC5zY2lwLlN5bnRheEtpbmQSJQoLZGlhZ25vc3RpY3MYBiADKAsyEC5zY2lwLkRpYWdub3N0aWMSFwoPZW5jbG9zaW5nX3JhbmdlGAcgAygFIoABCgpEaWFnbm9zdGljEiAKCHNldmVyaXR5GAEgASgOMg4uc2NpcC5TZXZlcml0eRIMCgRjb2RlGAIgASgJEg8KB21lc3NhZ2UYAyABKAkSDgoGc291cmNlGAQgASgJEiEKBHRhZ3MYBSADKA4yEy5zY2lwLkRpYWdub3N0aWNUYWcqMQoPUHJvdG9jb2xWZXJzaW9uEh4KGlVuc3BlY2lmaWVkUHJvdG9jb2xWZXJzaW9uEAAqQAoMVGV4dEVuY29kaW5nEhsKF1Vuc3BlY2lmaWVkVGV4dEVuY29kaW5nEAASCAoEVVRGOBABEgkKBVVURjE2EAIqpAEKEFBvc2l0aW9uRW5jb2RpbmcSHwobVW5zcGVjaWZpZWRQb3NpdGlvbkVuY29kaW5nEAASIwofVVRGOENvZGVVbml0T2Zmc2V0RnJvbUxpbmVTdGFydBABEiQKIFVURjE2Q29kZVVuaXRPZmZzZXRGcm9tTGluZVN0YXJ0EAISJAogVVRGMzJDb2RlVW5pdE9mZnNldEZyb21MaW5lU3RhcnQQAyqUAQoKU3ltYm9sUm9sZRIZChVVbnNwZWNpZmllZFN5bWJvbFJvbGUQABIOCgpEZWZpbml0aW9uEAESCgoGSW1wb3J0EAISDwoLV3JpdGVBY2Nlc3MQBBIOCgpSZWFkQWNjZXNzEAgSDQoJR2VuZXJhdGVkEBASCAoEVGVzdBAgEhUKEUZvcndhcmREZWZpbml0aW9uEEAq6gYKClN5bnRheEtpbmQSGQoVVW5zcGVjaWZpZWRTeW50YXhLaW5kEAASCwoHQ29tbWVudBABEhgKFFB1bmN0dWF0aW9uRGVsaW1pdGVyEAISFgoSUHVuY3R1YXRpb25CcmFja2V0EAMSCwoHS2V5d29yZBAEEhkKEUlkZW50aWZpZXJLZXl3b3JkEAQaAggBEhYKEklkZW50aWZpZXJPcGVyYXRvchAFEg4KCklkZW50aWZpZXIQBhIVChFJZGVudGlmaWVyQnVpbHRpbhAHEhIKDklkZW50aWZpZXJOdWxsEAgSFgoSSWRlbnRpZmllckNvbnN0YW50EAkSGwoXSWRlbnRpZmllck11dGFibGVHbG9iYWwQChIXChNJZGVudGlmaWVyUGFyYW1ldGVyEAsSEwoPSWRlbnRpZmllckxvY2FsEAwSFgoSSWRlbnRpZmllclNoYWRvd2VkEA0SFwoTSWRlbnRpZmllck5hbWVzcGFjZRAOEhgKEElkZW50aWZpZXJNb2R1bGUQDhoCCAESFgoSSWRlbnRpZmllckZ1bmN0aW9uEA8SIAocSWRlbnRpZmllckZ1bmN0aW9uRGVmaW5pdGlvbhAQEhMKD0lkZW50aWZpZXJNYWNybxAREh0KGUlkZW50aWZpZXJNYWNyb0RlZmluaXRpb24QEhISCg5JZGVudGlmaWVyVHlwZRATEhkKFUlkZW50aWZpZXJCdWlsdGluVHlwZRAUEhcKE0lkZW50aWZpZXJBdHRyaWJ1dGUQFRIPCgtSZWdleEVzY2FwZRAWEhEKDVJlZ2V4UmVwZWF0ZWQQFxIRCg1SZWdleFdpbGRjYXJkEBgSEgoOUmVnZXhEZWxpbWl0ZXIQGRINCglSZWdleEpvaW4QGhIRCg1TdHJpbmdMaXRlcmFsEBsSFwoTU3RyaW5nTGl0ZXJhbEVzY2FwZRAcEhgKFFN0cmluZ0xpdGVyYWxTcGVjaWFsEB0SFAoQU3RyaW5nTGl0ZXJhbEtleRAeEhQKEENoYXJhY3RlckxpdGVyYWwQHxISCg5OdW1lcmljTGl0ZXJhbBAgEhIKDkJvb2xlYW5MaXRlcmFsECESBwoDVGFnECISEAoMVGFnQXR0cmlidXRlECMSEAoMVGFnRGVsaW1pdGVyECQaAhABKlYKCFNldmVyaXR5EhcKE1Vuc3BlY2lmaWVkU2V2ZXJpdHkQABIJCgVFcnJvchABEgsKB1dhcm5pbmcQAhIPCgtJbmZvcm1hdGlvbhADEggKBEhpbnQQBCpOCg1EaWFnbm9zdGljVGFnEhwKGFVuc3BlY2lmaWVkRGlhZ25vc3RpY1RhZxAAEg8KC1VubmVjZXNzYXJ5EAESDgoKRGVwcmVjYXRlZBACKpsKCghMYW5ndWFnZRIXChNVbnNwZWNpZmllZExhbmd1YWdlEAASCAoEQUJBUBA8EggKBEFwZXgQYBIHCgNBUEwQMRIHCgNBZGEQJxIICgRBZ2RhEC0SDAoIQXNjaWlEb2MQVhIMCghBc3NlbWJseRA6EgcKA0F3axBCEgcKA0JhdBBEEgoKBkJpYlRlWBBREgUKAUMQIhIJCgVDT0JPTBA7EgcKA0NQUBAjEgcKA0NTUxAaEgoKBkNTaGFycBABEgsKB0Nsb2p1cmUQCBIQCgxDb2ZmZWVzY3JpcHQQFRIOCgpDb21tb25MaXNwEAkSBwoDQ29xEC8SCAoEQ1VEQRBhEggKBERhcnQQAxIKCgZEZWxwaGkQORIICgREaWZmEFgSDgoKRG9ja2VyZmlsZRBQEgoKBkR5YWxvZxAyEgoKBkVsaXhpchAREgoKBkVybGFuZxASEgoKBkZTaGFycBAqEggKBEZpc2gQQRIICgRGbG93EBgSCwoHRm9ydHJhbhA4Eg4KCkdpdF9Db21taXQQWxIOCgpHaXRfQ29uZmlnEFkSDgoKR2l0X1JlYmFzZRBcEgYKAkdvECESCwoHR3JhcGhRTBBiEgoKBkdyb292eRAHEggKBEhUTUwQHhIICgRIYWNrEBQSDgoKSGFuZGxlYmFycxBaEgsKB0hhc2tlbGwQLBIJCgVJZHJpcxAuEgcKA0luaRBIEgUKAUoQMxIICgRKU09OEEsSCAoESmF2YRAGEg4KCkphdmFTY3JpcHQQFhITCg9KYXZhU2NyaXB0UmVhY3QQXRILCgdKc29ubmV0EEwSCQoFSnVsaWEQNxIMCghKdXN0ZmlsZRBtEgoKBktvdGxpbhAEEgkKBUxhVGVYEFMSCAoETGVhbhAwEggKBExlc3MQGxIHCgNMdWEQDBIICgRMdWF1EGwSDAoITWFrZWZpbGUQTxIMCghNYXJrZG93bhBUEgoKBk1hdGxhYhA0EgoKBk5pY2tlbBBuEgcKA05peBBNEgkKBU9DYW1sECkSDwoLT2JqZWN0aXZlX0MQJBIRCg1PYmplY3RpdmVfQ1BQECUSCgoGUGFzY2FsEGMSBwoDUEhQEBMSCQoFUExTUUwQRhIICgRQZXJsEA0SDgoKUG93ZXJTaGVsbBBDEgoKBlByb2xvZxBHEgwKCFByb3RvYnVmEGQSCgoGUHl0aG9uEA8SBQoBUhA2EgoKBlJhY2tldBALEggKBFJha3UQDhIJCgVSYXpvchA+EgkKBVJlcHJvEGYSCAoEUmVTVBBVEggKBFJ1YnkQEBIICgRSdXN0ECgSBwoDU0FTED0SCAoEU0NTUxAdEgcKA1NNTBArEgcKA1NRTBBFEggKBFNhc3MQHBIJCgVTY2FsYRAFEgoKBlNjaGVtZRAKEg8KC1NoZWxsU2NyaXB0EEASCwoHU2t5bGFyaxBOEgkKBVNsYW5nEGsSDAoIU29saWRpdHkQXxIKCgZTdmVsdGUQahIJCgVTd2lmdBACEgcKA1RjbBBlEggKBFRPTUwQSRIHCgNUZVgQUhIKCgZUaHJpZnQQZxIOCgpUeXBlU2NyaXB0EBcSEwoPVHlwZVNjcmlwdFJlYWN0EF4SCwoHVmVyaWxvZxBoEggKBFZIREwQaRIPCgtWaXN1YWxCYXNpYxA/EgcKA1Z1ZRAZEgsKB1dvbGZyYW0QNRIHCgNYTUwQHxIHCgNYU0wQIBIICgRZQU1MEEoSBwoDWmlnECZCLVorZ2l0aHViLmNvbS9zY2lwLWNvZGUvc2NpcC9iaW5kaW5ncy9nby9zY2lwL2IGcHJvdG8z");
/**
 * Describes the message scip.Index.
 * Use `create(IndexSchema)` to create a new message.
 */
export const IndexSchema = /*@__PURE__*/ messageDesc(file_scip, 0);
/**
 * Describes the message scip.Metadata.
 * Use `create(MetadataSchema)` to create a new message.
 */
export const MetadataSchema = /*@__PURE__*/ messageDesc(file_scip, 1);
/**
 * Describes the message scip.ToolInfo.
 * Use `create(ToolInfoSchema)` to create a new message.
 */
export const ToolInfoSchema = /*@__PURE__*/ messageDesc(file_scip, 2);
/**
 * Describes the message scip.Document.
 * Use `create(DocumentSchema)` to create a new message.
 */
export const DocumentSchema = /*@__PURE__*/ messageDesc(file_scip, 3);
/**
 * Describes the message scip.Symbol.
 * Use `create(SymbolSchema)` to create a new message.
 */
export const SymbolSchema = /*@__PURE__*/ messageDesc(file_scip, 4);
/**
 * Describes the message scip.Package.
 * Use `create(PackageSchema)` to create a new message.
 */
export const PackageSchema = /*@__PURE__*/ messageDesc(file_scip, 5);
/**
 * Describes the message scip.Descriptor.
 * Use `create(DescriptorSchema)` to create a new message.
 */
export const DescriptorSchema = /*@__PURE__*/ messageDesc(file_scip, 6);
/**
 * @generated from enum scip.Descriptor.Suffix
 */
export var Descriptor_Suffix;
(function (Descriptor_Suffix) {
    /**
     * @generated from enum value: UnspecifiedSuffix = 0;
     */
    Descriptor_Suffix[Descriptor_Suffix["UnspecifiedSuffix"] = 0] = "UnspecifiedSuffix";
    /**
     * Unit of code abstraction and/or namespacing.
     *
     * NOTE: This corresponds to a package in Go and JVM languages.
     *
     * @generated from enum value: Namespace = 1;
     */
    Descriptor_Suffix[Descriptor_Suffix["Namespace"] = 1] = "Namespace";
    /**
     * Use Namespace instead.
     *
     * @generated from enum value: Package = 1 [deprecated = true];
     * @deprecated
     */
    Descriptor_Suffix[Descriptor_Suffix["Package"] = 1] = "Package";
    /**
     * @generated from enum value: Type = 2;
     */
    Descriptor_Suffix[Descriptor_Suffix["Type"] = 2] = "Type";
    /**
     * @generated from enum value: Term = 3;
     */
    Descriptor_Suffix[Descriptor_Suffix["Term"] = 3] = "Term";
    /**
     * @generated from enum value: Method = 4;
     */
    Descriptor_Suffix[Descriptor_Suffix["Method"] = 4] = "Method";
    /**
     * @generated from enum value: TypeParameter = 5;
     */
    Descriptor_Suffix[Descriptor_Suffix["TypeParameter"] = 5] = "TypeParameter";
    /**
     * @generated from enum value: Parameter = 6;
     */
    Descriptor_Suffix[Descriptor_Suffix["Parameter"] = 6] = "Parameter";
    /**
     * Can be used for any purpose.
     *
     * @generated from enum value: Meta = 7;
     */
    Descriptor_Suffix[Descriptor_Suffix["Meta"] = 7] = "Meta";
    /**
     * @generated from enum value: Local = 8;
     */
    Descriptor_Suffix[Descriptor_Suffix["Local"] = 8] = "Local";
    /**
     * @generated from enum value: Macro = 9;
     */
    Descriptor_Suffix[Descriptor_Suffix["Macro"] = 9] = "Macro";
})(Descriptor_Suffix || (Descriptor_Suffix = {}));
/**
 * Describes the enum scip.Descriptor.Suffix.
 */
export const Descriptor_SuffixSchema = /*@__PURE__*/ enumDesc(file_scip, 6, 0);
/**
 * Describes the message scip.SymbolInformation.
 * Use `create(SymbolInformationSchema)` to create a new message.
 */
export const SymbolInformationSchema = /*@__PURE__*/ messageDesc(file_scip, 7);
/**
 * (optional) Kind represents the fine-grained category of a symbol, suitable for presenting
 * information about the symbol's meaning in the language.
 *
 * For example:
 * - A Java method would have the kind `Method` while a Go function would
 *   have the kind `Function`, even if the symbols for these use the same
 *   syntax for the descriptor `SymbolDescriptor.Suffix.Method`.
 * - A Go struct has the symbol kind `Struct` while a Java class has
 *   the symbol kind `Class` even if they both have the same descriptor:
 *   `SymbolDescriptor.Suffix.Type`.
 *
 * Since Kind is more fine-grained than Suffix:
 * - If two symbols have the same Kind, they should share the same Suffix.
 * - If two symbols have different Suffixes, they should have different Kinds.
 *
 * @generated from enum scip.SymbolInformation.Kind
 */
export var SymbolInformation_Kind;
(function (SymbolInformation_Kind) {
    /**
     * @generated from enum value: UnspecifiedKind = 0;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["UnspecifiedKind"] = 0] = "UnspecifiedKind";
    /**
     * A method which may or may not have a body. For Java, Kotlin etc.
     *
     * @generated from enum value: AbstractMethod = 66;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["AbstractMethod"] = 66] = "AbstractMethod";
    /**
     * For Ruby's attr_accessor
     *
     * @generated from enum value: Accessor = 72;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Accessor"] = 72] = "Accessor";
    /**
     * @generated from enum value: Array = 1;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Array"] = 1] = "Array";
    /**
     * For Alloy
     *
     * @generated from enum value: Assertion = 2;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Assertion"] = 2] = "Assertion";
    /**
     * @generated from enum value: AssociatedType = 3;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["AssociatedType"] = 3] = "AssociatedType";
    /**
     * For C++
     *
     * @generated from enum value: Attribute = 4;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Attribute"] = 4] = "Attribute";
    /**
     * For Lean
     *
     * @generated from enum value: Axiom = 5;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Axiom"] = 5] = "Axiom";
    /**
     * @generated from enum value: Boolean = 6;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Boolean"] = 6] = "Boolean";
    /**
     * @generated from enum value: Class = 7;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Class"] = 7] = "Class";
    /**
     * For C++
     *
     * @generated from enum value: Concept = 86;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Concept"] = 86] = "Concept";
    /**
     * @generated from enum value: Constant = 8;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Constant"] = 8] = "Constant";
    /**
     * @generated from enum value: Constructor = 9;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Constructor"] = 9] = "Constructor";
    /**
     * For Solidity
     *
     * @generated from enum value: Contract = 62;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Contract"] = 62] = "Contract";
    /**
     * For Haskell
     *
     * @generated from enum value: DataFamily = 10;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["DataFamily"] = 10] = "DataFamily";
    /**
     * For C# and F#
     *
     * @generated from enum value: Delegate = 73;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Delegate"] = 73] = "Delegate";
    /**
     * @generated from enum value: Enum = 11;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Enum"] = 11] = "Enum";
    /**
     * @generated from enum value: EnumMember = 12;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["EnumMember"] = 12] = "EnumMember";
    /**
     * @generated from enum value: Error = 63;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Error"] = 63] = "Error";
    /**
     * @generated from enum value: Event = 13;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Event"] = 13] = "Event";
    /**
     * For Dart
     *
     * @generated from enum value: Extension = 84;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Extension"] = 84] = "Extension";
    /**
     * For Alloy
     *
     * @generated from enum value: Fact = 14;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Fact"] = 14] = "Fact";
    /**
     * @generated from enum value: Field = 15;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Field"] = 15] = "Field";
    /**
     * @generated from enum value: File = 16;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["File"] = 16] = "File";
    /**
     * @generated from enum value: Function = 17;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Function"] = 17] = "Function";
    /**
     * For 'get' in Swift, 'attr_reader' in Ruby
     *
     * @generated from enum value: Getter = 18;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Getter"] = 18] = "Getter";
    /**
     * For Raku
     *
     * @generated from enum value: Grammar = 19;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Grammar"] = 19] = "Grammar";
    /**
     * For Purescript and Lean
     *
     * @generated from enum value: Instance = 20;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Instance"] = 20] = "Instance";
    /**
     * @generated from enum value: Interface = 21;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Interface"] = 21] = "Interface";
    /**
     * @generated from enum value: Key = 22;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Key"] = 22] = "Key";
    /**
     * For Racket
     *
     * @generated from enum value: Lang = 23;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Lang"] = 23] = "Lang";
    /**
     * For Lean
     *
     * @generated from enum value: Lemma = 24;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Lemma"] = 24] = "Lemma";
    /**
     * For solidity
     *
     * @generated from enum value: Library = 64;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Library"] = 64] = "Library";
    /**
     * @generated from enum value: Macro = 25;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Macro"] = 25] = "Macro";
    /**
     * @generated from enum value: Method = 26;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Method"] = 26] = "Method";
    /**
     * For Ruby
     *
     * @generated from enum value: MethodAlias = 74;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["MethodAlias"] = 74] = "MethodAlias";
    /**
     * Analogous to 'ThisParameter' and 'SelfParameter', but for languages
     * like Go where the receiver doesn't have a conventional name.
     *
     * @generated from enum value: MethodReceiver = 27;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["MethodReceiver"] = 27] = "MethodReceiver";
    /**
     * Analogous to 'AbstractMethod', for Go.
     *
     * @generated from enum value: MethodSpecification = 67;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["MethodSpecification"] = 67] = "MethodSpecification";
    /**
     * For Protobuf
     *
     * @generated from enum value: Message = 28;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Message"] = 28] = "Message";
    /**
     * For Dart
     *
     * @generated from enum value: Mixin = 85;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Mixin"] = 85] = "Mixin";
    /**
     * For Solidity
     *
     * @generated from enum value: Modifier = 65;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Modifier"] = 65] = "Modifier";
    /**
     * @generated from enum value: Module = 29;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Module"] = 29] = "Module";
    /**
     * @generated from enum value: Namespace = 30;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Namespace"] = 30] = "Namespace";
    /**
     * @generated from enum value: Null = 31;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Null"] = 31] = "Null";
    /**
     * @generated from enum value: Number = 32;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Number"] = 32] = "Number";
    /**
     * @generated from enum value: Object = 33;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Object"] = 33] = "Object";
    /**
     * @generated from enum value: Operator = 34;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Operator"] = 34] = "Operator";
    /**
     * @generated from enum value: Package = 35;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Package"] = 35] = "Package";
    /**
     * @generated from enum value: PackageObject = 36;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["PackageObject"] = 36] = "PackageObject";
    /**
     * @generated from enum value: Parameter = 37;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Parameter"] = 37] = "Parameter";
    /**
     * @generated from enum value: ParameterLabel = 38;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["ParameterLabel"] = 38] = "ParameterLabel";
    /**
     * For Haskell's PatternSynonyms
     *
     * @generated from enum value: Pattern = 39;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Pattern"] = 39] = "Pattern";
    /**
     * For Alloy
     *
     * @generated from enum value: Predicate = 40;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Predicate"] = 40] = "Predicate";
    /**
     * @generated from enum value: Property = 41;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Property"] = 41] = "Property";
    /**
     * Analogous to 'Trait' and 'TypeClass', for Swift and Objective-C
     *
     * @generated from enum value: Protocol = 42;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Protocol"] = 42] = "Protocol";
    /**
     * Analogous to 'AbstractMethod', for Swift and Objective-C.
     *
     * @generated from enum value: ProtocolMethod = 68;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["ProtocolMethod"] = 68] = "ProtocolMethod";
    /**
     * Analogous to 'AbstractMethod', for C++.
     *
     * @generated from enum value: PureVirtualMethod = 69;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["PureVirtualMethod"] = 69] = "PureVirtualMethod";
    /**
     * For Haskell
     *
     * @generated from enum value: Quasiquoter = 43;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Quasiquoter"] = 43] = "Quasiquoter";
    /**
     * 'self' in Python, Rust, Swift etc.
     *
     * @generated from enum value: SelfParameter = 44;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["SelfParameter"] = 44] = "SelfParameter";
    /**
     * For 'set' in Swift, 'attr_writer' in Ruby
     *
     * @generated from enum value: Setter = 45;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Setter"] = 45] = "Setter";
    /**
     * For Alloy, analogous to 'Struct'.
     *
     * @generated from enum value: Signature = 46;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Signature"] = 46] = "Signature";
    /**
     * For Ruby
     *
     * @generated from enum value: SingletonClass = 75;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["SingletonClass"] = 75] = "SingletonClass";
    /**
     * Analogous to 'StaticMethod', for Ruby.
     *
     * @generated from enum value: SingletonMethod = 76;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["SingletonMethod"] = 76] = "SingletonMethod";
    /**
     * Analogous to 'StaticField', for C++
     *
     * @generated from enum value: StaticDataMember = 77;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["StaticDataMember"] = 77] = "StaticDataMember";
    /**
     * For C#
     *
     * @generated from enum value: StaticEvent = 78;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["StaticEvent"] = 78] = "StaticEvent";
    /**
     * For C#
     *
     * @generated from enum value: StaticField = 79;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["StaticField"] = 79] = "StaticField";
    /**
     * For Java, C#, C++ etc.
     *
     * @generated from enum value: StaticMethod = 80;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["StaticMethod"] = 80] = "StaticMethod";
    /**
     * For C#, TypeScript etc.
     *
     * @generated from enum value: StaticProperty = 81;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["StaticProperty"] = 81] = "StaticProperty";
    /**
     * For C, C++
     *
     * @generated from enum value: StaticVariable = 82;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["StaticVariable"] = 82] = "StaticVariable";
    /**
     * @generated from enum value: String = 48;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["String"] = 48] = "String";
    /**
     * @generated from enum value: Struct = 49;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Struct"] = 49] = "Struct";
    /**
     * For Swift
     *
     * @generated from enum value: Subscript = 47;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Subscript"] = 47] = "Subscript";
    /**
     * For Lean
     *
     * @generated from enum value: Tactic = 50;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Tactic"] = 50] = "Tactic";
    /**
     * For Lean
     *
     * @generated from enum value: Theorem = 51;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Theorem"] = 51] = "Theorem";
    /**
     * Method receiver for languages
     * 'this' in JavaScript, C++, Java etc.
     *
     * @generated from enum value: ThisParameter = 52;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["ThisParameter"] = 52] = "ThisParameter";
    /**
     * Analogous to 'Protocol' and 'TypeClass', for Rust, Scala etc.
     *
     * @generated from enum value: Trait = 53;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Trait"] = 53] = "Trait";
    /**
     * Analogous to 'AbstractMethod', for Rust, Scala etc.
     *
     * @generated from enum value: TraitMethod = 70;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["TraitMethod"] = 70] = "TraitMethod";
    /**
     * Data type definition for languages like OCaml which use `type`
     * rather than separate keywords like `struct` and `enum`.
     *
     * @generated from enum value: Type = 54;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Type"] = 54] = "Type";
    /**
     * @generated from enum value: TypeAlias = 55;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["TypeAlias"] = 55] = "TypeAlias";
    /**
     * Analogous to 'Trait' and 'Protocol', for Haskell, Purescript etc.
     *
     * @generated from enum value: TypeClass = 56;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["TypeClass"] = 56] = "TypeClass";
    /**
     * Analogous to 'AbstractMethod', for Haskell, Purescript etc.
     *
     * @generated from enum value: TypeClassMethod = 71;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["TypeClassMethod"] = 71] = "TypeClassMethod";
    /**
     * For Haskell
     *
     * @generated from enum value: TypeFamily = 57;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["TypeFamily"] = 57] = "TypeFamily";
    /**
     * @generated from enum value: TypeParameter = 58;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["TypeParameter"] = 58] = "TypeParameter";
    /**
     * For C, C++, Capn Proto
     *
     * @generated from enum value: Union = 59;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Union"] = 59] = "Union";
    /**
     * @generated from enum value: Value = 60;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Value"] = 60] = "Value";
    /**
     * Next = 87;
     * Feel free to open a PR proposing new language-specific kinds.
     *
     * @generated from enum value: Variable = 61;
     */
    SymbolInformation_Kind[SymbolInformation_Kind["Variable"] = 61] = "Variable";
})(SymbolInformation_Kind || (SymbolInformation_Kind = {}));
/**
 * Describes the enum scip.SymbolInformation.Kind.
 */
export const SymbolInformation_KindSchema = /*@__PURE__*/ enumDesc(file_scip, 7, 0);
/**
 * Describes the message scip.Relationship.
 * Use `create(RelationshipSchema)` to create a new message.
 */
export const RelationshipSchema = /*@__PURE__*/ messageDesc(file_scip, 8);
/**
 * Describes the message scip.Occurrence.
 * Use `create(OccurrenceSchema)` to create a new message.
 */
export const OccurrenceSchema = /*@__PURE__*/ messageDesc(file_scip, 9);
/**
 * Describes the message scip.Diagnostic.
 * Use `create(DiagnosticSchema)` to create a new message.
 */
export const DiagnosticSchema = /*@__PURE__*/ messageDesc(file_scip, 10);
/**
 * @generated from enum scip.ProtocolVersion
 */
export var ProtocolVersion;
(function (ProtocolVersion) {
    /**
     * @generated from enum value: UnspecifiedProtocolVersion = 0;
     */
    ProtocolVersion[ProtocolVersion["UnspecifiedProtocolVersion"] = 0] = "UnspecifiedProtocolVersion";
})(ProtocolVersion || (ProtocolVersion = {}));
/**
 * Describes the enum scip.ProtocolVersion.
 */
export const ProtocolVersionSchema = /*@__PURE__*/ enumDesc(file_scip, 0);
/**
 * @generated from enum scip.TextEncoding
 */
export var TextEncoding;
(function (TextEncoding) {
    /**
     * @generated from enum value: UnspecifiedTextEncoding = 0;
     */
    TextEncoding[TextEncoding["UnspecifiedTextEncoding"] = 0] = "UnspecifiedTextEncoding";
    /**
     * @generated from enum value: UTF8 = 1;
     */
    TextEncoding[TextEncoding["UTF8"] = 1] = "UTF8";
    /**
     * @generated from enum value: UTF16 = 2;
     */
    TextEncoding[TextEncoding["UTF16"] = 2] = "UTF16";
})(TextEncoding || (TextEncoding = {}));
/**
 * Describes the enum scip.TextEncoding.
 */
export const TextEncodingSchema = /*@__PURE__*/ enumDesc(file_scip, 1);
/**
 * Encoding used to interpret the 'character' value in source ranges.
 *
 * @generated from enum scip.PositionEncoding
 */
export var PositionEncoding;
(function (PositionEncoding) {
    /**
     * Default value. This value should not be used by new SCIP indexers
     * so that a consumer can process the SCIP index without ambiguity.
     *
     * @generated from enum value: UnspecifiedPositionEncoding = 0;
     */
    PositionEncoding[PositionEncoding["UnspecifiedPositionEncoding"] = 0] = "UnspecifiedPositionEncoding";
    /**
     * The 'character' value is interpreted as an offset in terms
     * of UTF-8 code units (i.e. bytes).
     *
     * Example: For the string "🚀 Woo" in UTF-8, the bytes are
     * [240, 159, 154, 128, 32, 87, 111, 111], so the offset for 'W'
     * would be 5.
     *
     * @generated from enum value: UTF8CodeUnitOffsetFromLineStart = 1;
     */
    PositionEncoding[PositionEncoding["UTF8CodeUnitOffsetFromLineStart"] = 1] = "UTF8CodeUnitOffsetFromLineStart";
    /**
     * The 'character' value is interpreted as an offset in terms
     * of UTF-16 code units (each is 2 bytes).
     *
     * Example: For the string "🚀 Woo", the UTF-16 code units are
     * ['\ud83d', '\ude80', ' ', 'W', 'o', 'o'], so the offset for 'W'
     * would be 3.
     *
     * @generated from enum value: UTF16CodeUnitOffsetFromLineStart = 2;
     */
    PositionEncoding[PositionEncoding["UTF16CodeUnitOffsetFromLineStart"] = 2] = "UTF16CodeUnitOffsetFromLineStart";
    /**
     * The 'character' value is interpreted as an offset in terms
     * of UTF-32 code units (each is 4 bytes).
     *
     * Example: For the string "🚀 Woo", the UTF-32 code units are
     * ['🚀', ' ', 'W', 'o', 'o'], so the offset for 'W' would be 2.
     *
     * @generated from enum value: UTF32CodeUnitOffsetFromLineStart = 3;
     */
    PositionEncoding[PositionEncoding["UTF32CodeUnitOffsetFromLineStart"] = 3] = "UTF32CodeUnitOffsetFromLineStart";
})(PositionEncoding || (PositionEncoding = {}));
/**
 * Describes the enum scip.PositionEncoding.
 */
export const PositionEncodingSchema = /*@__PURE__*/ enumDesc(file_scip, 2);
/**
 * SymbolRole declares what "role" a symbol has in an occurrence. A role is
 * encoded as a bitset where each bit represents a different role. For example,
 * to determine if the `Import` role is set, test whether the second bit of the
 * enum value is defined. In pseudocode, this can be implemented with the
 * logic: `const isImportRole = (role.value & SymbolRole.Import.value) > 0`.
 *
 * @generated from enum scip.SymbolRole
 */
export var SymbolRole;
(function (SymbolRole) {
    /**
     * This case is not meant to be used; it only exists to avoid an error
     * from the Protobuf code generator.
     *
     * @generated from enum value: UnspecifiedSymbolRole = 0;
     */
    SymbolRole[SymbolRole["UnspecifiedSymbolRole"] = 0] = "UnspecifiedSymbolRole";
    /**
     * Is the symbol defined here? If not, then this is a symbol reference.
     *
     * @generated from enum value: Definition = 1;
     */
    SymbolRole[SymbolRole["Definition"] = 1] = "Definition";
    /**
     * Is the symbol imported here?
     *
     * @generated from enum value: Import = 2;
     */
    SymbolRole[SymbolRole["Import"] = 2] = "Import";
    /**
     * Is the symbol written here?
     *
     * @generated from enum value: WriteAccess = 4;
     */
    SymbolRole[SymbolRole["WriteAccess"] = 4] = "WriteAccess";
    /**
     * Is the symbol read here?
     *
     * @generated from enum value: ReadAccess = 8;
     */
    SymbolRole[SymbolRole["ReadAccess"] = 8] = "ReadAccess";
    /**
     * Is the symbol in generated code?
     *
     * @generated from enum value: Generated = 16;
     */
    SymbolRole[SymbolRole["Generated"] = 16] = "Generated";
    /**
     * Is the symbol in test code?
     *
     * @generated from enum value: Test = 32;
     */
    SymbolRole[SymbolRole["Test"] = 32] = "Test";
    /**
     * Is this a signature for a symbol that is defined elsewhere?
     *
     * Applies to forward declarations for languages like C, C++
     * and Objective-C, as well as `val` declarations in interface
     * files in languages like SML and OCaml.
     *
     * @generated from enum value: ForwardDefinition = 64;
     */
    SymbolRole[SymbolRole["ForwardDefinition"] = 64] = "ForwardDefinition";
})(SymbolRole || (SymbolRole = {}));
/**
 * Describes the enum scip.SymbolRole.
 */
export const SymbolRoleSchema = /*@__PURE__*/ enumDesc(file_scip, 3);
/**
 * @generated from enum scip.SyntaxKind
 */
export var SyntaxKind;
(function (SyntaxKind) {
    /**
     * @generated from enum value: UnspecifiedSyntaxKind = 0;
     */
    SyntaxKind[SyntaxKind["UnspecifiedSyntaxKind"] = 0] = "UnspecifiedSyntaxKind";
    /**
     * Comment, including comment markers and text
     *
     * @generated from enum value: Comment = 1;
     */
    SyntaxKind[SyntaxKind["Comment"] = 1] = "Comment";
    /**
     * `;` `.` `,`
     *
     * @generated from enum value: PunctuationDelimiter = 2;
     */
    SyntaxKind[SyntaxKind["PunctuationDelimiter"] = 2] = "PunctuationDelimiter";
    /**
     * (), {}, [] when used syntactically
     *
     * @generated from enum value: PunctuationBracket = 3;
     */
    SyntaxKind[SyntaxKind["PunctuationBracket"] = 3] = "PunctuationBracket";
    /**
     * `if`, `else`, `return`, `class`, etc.
     *
     * @generated from enum value: Keyword = 4;
     */
    SyntaxKind[SyntaxKind["Keyword"] = 4] = "Keyword";
    /**
     * @generated from enum value: IdentifierKeyword = 4 [deprecated = true];
     * @deprecated
     */
    SyntaxKind[SyntaxKind["IdentifierKeyword"] = 4] = "IdentifierKeyword";
    /**
     * `+`, `*`, etc.
     *
     * @generated from enum value: IdentifierOperator = 5;
     */
    SyntaxKind[SyntaxKind["IdentifierOperator"] = 5] = "IdentifierOperator";
    /**
     * non-specific catch-all for any identifier not better described elsewhere
     *
     * @generated from enum value: Identifier = 6;
     */
    SyntaxKind[SyntaxKind["Identifier"] = 6] = "Identifier";
    /**
     * Identifiers builtin to the language: `min`, `print` in Python.
     *
     * @generated from enum value: IdentifierBuiltin = 7;
     */
    SyntaxKind[SyntaxKind["IdentifierBuiltin"] = 7] = "IdentifierBuiltin";
    /**
     * Identifiers representing `null`-like values: `None` in Python, `nil` in Go.
     *
     * @generated from enum value: IdentifierNull = 8;
     */
    SyntaxKind[SyntaxKind["IdentifierNull"] = 8] = "IdentifierNull";
    /**
     * `xyz` in `const xyz = "hello"`
     *
     * @generated from enum value: IdentifierConstant = 9;
     */
    SyntaxKind[SyntaxKind["IdentifierConstant"] = 9] = "IdentifierConstant";
    /**
     * `var X = "hello"` in Go
     *
     * @generated from enum value: IdentifierMutableGlobal = 10;
     */
    SyntaxKind[SyntaxKind["IdentifierMutableGlobal"] = 10] = "IdentifierMutableGlobal";
    /**
     * Parameter definition and references
     *
     * @generated from enum value: IdentifierParameter = 11;
     */
    SyntaxKind[SyntaxKind["IdentifierParameter"] = 11] = "IdentifierParameter";
    /**
     * Identifiers for variable definitions and references within a local scope
     *
     * @generated from enum value: IdentifierLocal = 12;
     */
    SyntaxKind[SyntaxKind["IdentifierLocal"] = 12] = "IdentifierLocal";
    /**
     * Identifiers that shadow other identifiers in an outer scope
     *
     * @generated from enum value: IdentifierShadowed = 13;
     */
    SyntaxKind[SyntaxKind["IdentifierShadowed"] = 13] = "IdentifierShadowed";
    /**
     * Identifier representing a unit of code abstraction and/or namespacing.
     *
     * NOTE: This corresponds to a package in Go and JVM languages,
     * and a module in languages like Python and JavaScript.
     *
     * @generated from enum value: IdentifierNamespace = 14;
     */
    SyntaxKind[SyntaxKind["IdentifierNamespace"] = 14] = "IdentifierNamespace";
    /**
     * @generated from enum value: IdentifierModule = 14 [deprecated = true];
     * @deprecated
     */
    SyntaxKind[SyntaxKind["IdentifierModule"] = 14] = "IdentifierModule";
    /**
     * Function references, including calls
     *
     * @generated from enum value: IdentifierFunction = 15;
     */
    SyntaxKind[SyntaxKind["IdentifierFunction"] = 15] = "IdentifierFunction";
    /**
     * Function definition only
     *
     * @generated from enum value: IdentifierFunctionDefinition = 16;
     */
    SyntaxKind[SyntaxKind["IdentifierFunctionDefinition"] = 16] = "IdentifierFunctionDefinition";
    /**
     * Macro references, including invocations
     *
     * @generated from enum value: IdentifierMacro = 17;
     */
    SyntaxKind[SyntaxKind["IdentifierMacro"] = 17] = "IdentifierMacro";
    /**
     * Macro definition only
     *
     * @generated from enum value: IdentifierMacroDefinition = 18;
     */
    SyntaxKind[SyntaxKind["IdentifierMacroDefinition"] = 18] = "IdentifierMacroDefinition";
    /**
     * non-builtin types
     *
     * @generated from enum value: IdentifierType = 19;
     */
    SyntaxKind[SyntaxKind["IdentifierType"] = 19] = "IdentifierType";
    /**
     * builtin types only, such as `str` for Python or `int` in Go
     *
     * @generated from enum value: IdentifierBuiltinType = 20;
     */
    SyntaxKind[SyntaxKind["IdentifierBuiltinType"] = 20] = "IdentifierBuiltinType";
    /**
     * Python decorators, c-like __attribute__
     *
     * @generated from enum value: IdentifierAttribute = 21;
     */
    SyntaxKind[SyntaxKind["IdentifierAttribute"] = 21] = "IdentifierAttribute";
    /**
     * `\b`
     *
     * @generated from enum value: RegexEscape = 22;
     */
    SyntaxKind[SyntaxKind["RegexEscape"] = 22] = "RegexEscape";
    /**
     * `*`, `+`
     *
     * @generated from enum value: RegexRepeated = 23;
     */
    SyntaxKind[SyntaxKind["RegexRepeated"] = 23] = "RegexRepeated";
    /**
     * `.`
     *
     * @generated from enum value: RegexWildcard = 24;
     */
    SyntaxKind[SyntaxKind["RegexWildcard"] = 24] = "RegexWildcard";
    /**
     * `(`, `)`, `[`, `]`
     *
     * @generated from enum value: RegexDelimiter = 25;
     */
    SyntaxKind[SyntaxKind["RegexDelimiter"] = 25] = "RegexDelimiter";
    /**
     * `|`, `-`
     *
     * @generated from enum value: RegexJoin = 26;
     */
    SyntaxKind[SyntaxKind["RegexJoin"] = 26] = "RegexJoin";
    /**
     * Literal strings: "Hello, world!"
     *
     * @generated from enum value: StringLiteral = 27;
     */
    SyntaxKind[SyntaxKind["StringLiteral"] = 27] = "StringLiteral";
    /**
     * non-regex escapes: "\t", "\n"
     *
     * @generated from enum value: StringLiteralEscape = 28;
     */
    SyntaxKind[SyntaxKind["StringLiteralEscape"] = 28] = "StringLiteralEscape";
    /**
     * datetimes within strings, special words within a string, `{}` in format strings
     *
     * @generated from enum value: StringLiteralSpecial = 29;
     */
    SyntaxKind[SyntaxKind["StringLiteralSpecial"] = 29] = "StringLiteralSpecial";
    /**
     * "key" in { "key": "value" }, useful for example in JSON
     *
     * @generated from enum value: StringLiteralKey = 30;
     */
    SyntaxKind[SyntaxKind["StringLiteralKey"] = 30] = "StringLiteralKey";
    /**
     * 'c' or similar, in languages that differentiate strings and characters
     *
     * @generated from enum value: CharacterLiteral = 31;
     */
    SyntaxKind[SyntaxKind["CharacterLiteral"] = 31] = "CharacterLiteral";
    /**
     * Literal numbers, both floats and integers
     *
     * @generated from enum value: NumericLiteral = 32;
     */
    SyntaxKind[SyntaxKind["NumericLiteral"] = 32] = "NumericLiteral";
    /**
     * `true`, `false`
     *
     * @generated from enum value: BooleanLiteral = 33;
     */
    SyntaxKind[SyntaxKind["BooleanLiteral"] = 33] = "BooleanLiteral";
    /**
     * Used for XML-like tags
     *
     * @generated from enum value: Tag = 34;
     */
    SyntaxKind[SyntaxKind["Tag"] = 34] = "Tag";
    /**
     * Attribute name in XML-like tags
     *
     * @generated from enum value: TagAttribute = 35;
     */
    SyntaxKind[SyntaxKind["TagAttribute"] = 35] = "TagAttribute";
    /**
     * Delimiters for XML-like tags
     *
     * @generated from enum value: TagDelimiter = 36;
     */
    SyntaxKind[SyntaxKind["TagDelimiter"] = 36] = "TagDelimiter";
})(SyntaxKind || (SyntaxKind = {}));
/**
 * Describes the enum scip.SyntaxKind.
 */
export const SyntaxKindSchema = /*@__PURE__*/ enumDesc(file_scip, 4);
/**
 * @generated from enum scip.Severity
 */
export var Severity;
(function (Severity) {
    /**
     * @generated from enum value: UnspecifiedSeverity = 0;
     */
    Severity[Severity["UnspecifiedSeverity"] = 0] = "UnspecifiedSeverity";
    /**
     * @generated from enum value: Error = 1;
     */
    Severity[Severity["Error"] = 1] = "Error";
    /**
     * @generated from enum value: Warning = 2;
     */
    Severity[Severity["Warning"] = 2] = "Warning";
    /**
     * @generated from enum value: Information = 3;
     */
    Severity[Severity["Information"] = 3] = "Information";
    /**
     * @generated from enum value: Hint = 4;
     */
    Severity[Severity["Hint"] = 4] = "Hint";
})(Severity || (Severity = {}));
/**
 * Describes the enum scip.Severity.
 */
export const SeveritySchema = /*@__PURE__*/ enumDesc(file_scip, 5);
/**
 * @generated from enum scip.DiagnosticTag
 */
export var DiagnosticTag;
(function (DiagnosticTag) {
    /**
     * @generated from enum value: UnspecifiedDiagnosticTag = 0;
     */
    DiagnosticTag[DiagnosticTag["UnspecifiedDiagnosticTag"] = 0] = "UnspecifiedDiagnosticTag";
    /**
     * @generated from enum value: Unnecessary = 1;
     */
    DiagnosticTag[DiagnosticTag["Unnecessary"] = 1] = "Unnecessary";
    /**
     * @generated from enum value: Deprecated = 2;
     */
    DiagnosticTag[DiagnosticTag["Deprecated"] = 2] = "Deprecated";
})(DiagnosticTag || (DiagnosticTag = {}));
/**
 * Describes the enum scip.DiagnosticTag.
 */
export const DiagnosticTagSchema = /*@__PURE__*/ enumDesc(file_scip, 6);
/**
 * Language standardises names of common programming languages that can be used
 * for the `Document.language` field. The primary purpose of this enum is to
 * prevent a situation where we have a single programming language ends up with
 * multiple string representations. For example, the C++ language uses the name
 * "CPP" in this enum and other names such as "cpp" are incompatible.
 * Feel free to send a pull-request to add missing programming languages.
 *
 * @generated from enum scip.Language
 */
export var Language;
(function (Language) {
    /**
     * @generated from enum value: UnspecifiedLanguage = 0;
     */
    Language[Language["UnspecifiedLanguage"] = 0] = "UnspecifiedLanguage";
    /**
     * @generated from enum value: ABAP = 60;
     */
    Language[Language["ABAP"] = 60] = "ABAP";
    /**
     * @generated from enum value: Apex = 96;
     */
    Language[Language["Apex"] = 96] = "Apex";
    /**
     * @generated from enum value: APL = 49;
     */
    Language[Language["APL"] = 49] = "APL";
    /**
     * @generated from enum value: Ada = 39;
     */
    Language[Language["Ada"] = 39] = "Ada";
    /**
     * @generated from enum value: Agda = 45;
     */
    Language[Language["Agda"] = 45] = "Agda";
    /**
     * @generated from enum value: AsciiDoc = 86;
     */
    Language[Language["AsciiDoc"] = 86] = "AsciiDoc";
    /**
     * @generated from enum value: Assembly = 58;
     */
    Language[Language["Assembly"] = 58] = "Assembly";
    /**
     * @generated from enum value: Awk = 66;
     */
    Language[Language["Awk"] = 66] = "Awk";
    /**
     * @generated from enum value: Bat = 68;
     */
    Language[Language["Bat"] = 68] = "Bat";
    /**
     * @generated from enum value: BibTeX = 81;
     */
    Language[Language["BibTeX"] = 81] = "BibTeX";
    /**
     * @generated from enum value: C = 34;
     */
    Language[Language["C"] = 34] = "C";
    /**
     * @generated from enum value: COBOL = 59;
     */
    Language[Language["COBOL"] = 59] = "COBOL";
    /**
     * C++ (the name "CPP" was chosen for consistency with LSP)
     *
     * @generated from enum value: CPP = 35;
     */
    Language[Language["CPP"] = 35] = "CPP";
    /**
     * @generated from enum value: CSS = 26;
     */
    Language[Language["CSS"] = 26] = "CSS";
    /**
     * @generated from enum value: CSharp = 1;
     */
    Language[Language["CSharp"] = 1] = "CSharp";
    /**
     * @generated from enum value: Clojure = 8;
     */
    Language[Language["Clojure"] = 8] = "Clojure";
    /**
     * @generated from enum value: Coffeescript = 21;
     */
    Language[Language["Coffeescript"] = 21] = "Coffeescript";
    /**
     * @generated from enum value: CommonLisp = 9;
     */
    Language[Language["CommonLisp"] = 9] = "CommonLisp";
    /**
     * @generated from enum value: Coq = 47;
     */
    Language[Language["Coq"] = 47] = "Coq";
    /**
     * @generated from enum value: CUDA = 97;
     */
    Language[Language["CUDA"] = 97] = "CUDA";
    /**
     * @generated from enum value: Dart = 3;
     */
    Language[Language["Dart"] = 3] = "Dart";
    /**
     * @generated from enum value: Delphi = 57;
     */
    Language[Language["Delphi"] = 57] = "Delphi";
    /**
     * @generated from enum value: Diff = 88;
     */
    Language[Language["Diff"] = 88] = "Diff";
    /**
     * @generated from enum value: Dockerfile = 80;
     */
    Language[Language["Dockerfile"] = 80] = "Dockerfile";
    /**
     * @generated from enum value: Dyalog = 50;
     */
    Language[Language["Dyalog"] = 50] = "Dyalog";
    /**
     * @generated from enum value: Elixir = 17;
     */
    Language[Language["Elixir"] = 17] = "Elixir";
    /**
     * @generated from enum value: Erlang = 18;
     */
    Language[Language["Erlang"] = 18] = "Erlang";
    /**
     * @generated from enum value: FSharp = 42;
     */
    Language[Language["FSharp"] = 42] = "FSharp";
    /**
     * @generated from enum value: Fish = 65;
     */
    Language[Language["Fish"] = 65] = "Fish";
    /**
     * @generated from enum value: Flow = 24;
     */
    Language[Language["Flow"] = 24] = "Flow";
    /**
     * @generated from enum value: Fortran = 56;
     */
    Language[Language["Fortran"] = 56] = "Fortran";
    /**
     * @generated from enum value: Git_Commit = 91;
     */
    Language[Language["Git_Commit"] = 91] = "Git_Commit";
    /**
     * @generated from enum value: Git_Config = 89;
     */
    Language[Language["Git_Config"] = 89] = "Git_Config";
    /**
     * @generated from enum value: Git_Rebase = 92;
     */
    Language[Language["Git_Rebase"] = 92] = "Git_Rebase";
    /**
     * @generated from enum value: Go = 33;
     */
    Language[Language["Go"] = 33] = "Go";
    /**
     * @generated from enum value: GraphQL = 98;
     */
    Language[Language["GraphQL"] = 98] = "GraphQL";
    /**
     * @generated from enum value: Groovy = 7;
     */
    Language[Language["Groovy"] = 7] = "Groovy";
    /**
     * @generated from enum value: HTML = 30;
     */
    Language[Language["HTML"] = 30] = "HTML";
    /**
     * @generated from enum value: Hack = 20;
     */
    Language[Language["Hack"] = 20] = "Hack";
    /**
     * @generated from enum value: Handlebars = 90;
     */
    Language[Language["Handlebars"] = 90] = "Handlebars";
    /**
     * @generated from enum value: Haskell = 44;
     */
    Language[Language["Haskell"] = 44] = "Haskell";
    /**
     * @generated from enum value: Idris = 46;
     */
    Language[Language["Idris"] = 46] = "Idris";
    /**
     * @generated from enum value: Ini = 72;
     */
    Language[Language["Ini"] = 72] = "Ini";
    /**
     * @generated from enum value: J = 51;
     */
    Language[Language["J"] = 51] = "J";
    /**
     * @generated from enum value: JSON = 75;
     */
    Language[Language["JSON"] = 75] = "JSON";
    /**
     * @generated from enum value: Java = 6;
     */
    Language[Language["Java"] = 6] = "Java";
    /**
     * @generated from enum value: JavaScript = 22;
     */
    Language[Language["JavaScript"] = 22] = "JavaScript";
    /**
     * @generated from enum value: JavaScriptReact = 93;
     */
    Language[Language["JavaScriptReact"] = 93] = "JavaScriptReact";
    /**
     * @generated from enum value: Jsonnet = 76;
     */
    Language[Language["Jsonnet"] = 76] = "Jsonnet";
    /**
     * @generated from enum value: Julia = 55;
     */
    Language[Language["Julia"] = 55] = "Julia";
    /**
     * @generated from enum value: Justfile = 109;
     */
    Language[Language["Justfile"] = 109] = "Justfile";
    /**
     * @generated from enum value: Kotlin = 4;
     */
    Language[Language["Kotlin"] = 4] = "Kotlin";
    /**
     * @generated from enum value: LaTeX = 83;
     */
    Language[Language["LaTeX"] = 83] = "LaTeX";
    /**
     * @generated from enum value: Lean = 48;
     */
    Language[Language["Lean"] = 48] = "Lean";
    /**
     * @generated from enum value: Less = 27;
     */
    Language[Language["Less"] = 27] = "Less";
    /**
     * @generated from enum value: Lua = 12;
     */
    Language[Language["Lua"] = 12] = "Lua";
    /**
     * @generated from enum value: Luau = 108;
     */
    Language[Language["Luau"] = 108] = "Luau";
    /**
     * @generated from enum value: Makefile = 79;
     */
    Language[Language["Makefile"] = 79] = "Makefile";
    /**
     * @generated from enum value: Markdown = 84;
     */
    Language[Language["Markdown"] = 84] = "Markdown";
    /**
     * @generated from enum value: Matlab = 52;
     */
    Language[Language["Matlab"] = 52] = "Matlab";
    /**
     * https://nickel-lang.org/
     *
     * @generated from enum value: Nickel = 110;
     */
    Language[Language["Nickel"] = 110] = "Nickel";
    /**
     * @generated from enum value: Nix = 77;
     */
    Language[Language["Nix"] = 77] = "Nix";
    /**
     * @generated from enum value: OCaml = 41;
     */
    Language[Language["OCaml"] = 41] = "OCaml";
    /**
     * @generated from enum value: Objective_C = 36;
     */
    Language[Language["Objective_C"] = 36] = "Objective_C";
    /**
     * @generated from enum value: Objective_CPP = 37;
     */
    Language[Language["Objective_CPP"] = 37] = "Objective_CPP";
    /**
     * @generated from enum value: Pascal = 99;
     */
    Language[Language["Pascal"] = 99] = "Pascal";
    /**
     * @generated from enum value: PHP = 19;
     */
    Language[Language["PHP"] = 19] = "PHP";
    /**
     * @generated from enum value: PLSQL = 70;
     */
    Language[Language["PLSQL"] = 70] = "PLSQL";
    /**
     * @generated from enum value: Perl = 13;
     */
    Language[Language["Perl"] = 13] = "Perl";
    /**
     * @generated from enum value: PowerShell = 67;
     */
    Language[Language["PowerShell"] = 67] = "PowerShell";
    /**
     * @generated from enum value: Prolog = 71;
     */
    Language[Language["Prolog"] = 71] = "Prolog";
    /**
     * @generated from enum value: Protobuf = 100;
     */
    Language[Language["Protobuf"] = 100] = "Protobuf";
    /**
     * @generated from enum value: Python = 15;
     */
    Language[Language["Python"] = 15] = "Python";
    /**
     * @generated from enum value: R = 54;
     */
    Language[Language["R"] = 54] = "R";
    /**
     * @generated from enum value: Racket = 11;
     */
    Language[Language["Racket"] = 11] = "Racket";
    /**
     * @generated from enum value: Raku = 14;
     */
    Language[Language["Raku"] = 14] = "Raku";
    /**
     * @generated from enum value: Razor = 62;
     */
    Language[Language["Razor"] = 62] = "Razor";
    /**
     * Internal language for testing SCIP
     *
     * @generated from enum value: Repro = 102;
     */
    Language[Language["Repro"] = 102] = "Repro";
    /**
     * @generated from enum value: ReST = 85;
     */
    Language[Language["ReST"] = 85] = "ReST";
    /**
     * @generated from enum value: Ruby = 16;
     */
    Language[Language["Ruby"] = 16] = "Ruby";
    /**
     * @generated from enum value: Rust = 40;
     */
    Language[Language["Rust"] = 40] = "Rust";
    /**
     * @generated from enum value: SAS = 61;
     */
    Language[Language["SAS"] = 61] = "SAS";
    /**
     * @generated from enum value: SCSS = 29;
     */
    Language[Language["SCSS"] = 29] = "SCSS";
    /**
     * @generated from enum value: SML = 43;
     */
    Language[Language["SML"] = 43] = "SML";
    /**
     * @generated from enum value: SQL = 69;
     */
    Language[Language["SQL"] = 69] = "SQL";
    /**
     * @generated from enum value: Sass = 28;
     */
    Language[Language["Sass"] = 28] = "Sass";
    /**
     * @generated from enum value: Scala = 5;
     */
    Language[Language["Scala"] = 5] = "Scala";
    /**
     * @generated from enum value: Scheme = 10;
     */
    Language[Language["Scheme"] = 10] = "Scheme";
    /**
     * Bash
     *
     * @generated from enum value: ShellScript = 64;
     */
    Language[Language["ShellScript"] = 64] = "ShellScript";
    /**
     * @generated from enum value: Skylark = 78;
     */
    Language[Language["Skylark"] = 78] = "Skylark";
    /**
     * @generated from enum value: Slang = 107;
     */
    Language[Language["Slang"] = 107] = "Slang";
    /**
     * @generated from enum value: Solidity = 95;
     */
    Language[Language["Solidity"] = 95] = "Solidity";
    /**
     * @generated from enum value: Svelte = 106;
     */
    Language[Language["Svelte"] = 106] = "Svelte";
    /**
     * @generated from enum value: Swift = 2;
     */
    Language[Language["Swift"] = 2] = "Swift";
    /**
     * @generated from enum value: Tcl = 101;
     */
    Language[Language["Tcl"] = 101] = "Tcl";
    /**
     * @generated from enum value: TOML = 73;
     */
    Language[Language["TOML"] = 73] = "TOML";
    /**
     * @generated from enum value: TeX = 82;
     */
    Language[Language["TeX"] = 82] = "TeX";
    /**
     * @generated from enum value: Thrift = 103;
     */
    Language[Language["Thrift"] = 103] = "Thrift";
    /**
     * @generated from enum value: TypeScript = 23;
     */
    Language[Language["TypeScript"] = 23] = "TypeScript";
    /**
     * @generated from enum value: TypeScriptReact = 94;
     */
    Language[Language["TypeScriptReact"] = 94] = "TypeScriptReact";
    /**
     * @generated from enum value: Verilog = 104;
     */
    Language[Language["Verilog"] = 104] = "Verilog";
    /**
     * @generated from enum value: VHDL = 105;
     */
    Language[Language["VHDL"] = 105] = "VHDL";
    /**
     * @generated from enum value: VisualBasic = 63;
     */
    Language[Language["VisualBasic"] = 63] = "VisualBasic";
    /**
     * @generated from enum value: Vue = 25;
     */
    Language[Language["Vue"] = 25] = "Vue";
    /**
     * @generated from enum value: Wolfram = 53;
     */
    Language[Language["Wolfram"] = 53] = "Wolfram";
    /**
     * @generated from enum value: XML = 31;
     */
    Language[Language["XML"] = 31] = "XML";
    /**
     * @generated from enum value: XSL = 32;
     */
    Language[Language["XSL"] = 32] = "XSL";
    /**
     * @generated from enum value: YAML = 74;
     */
    Language[Language["YAML"] = 74] = "YAML";
    /**
     * NextLanguage = 111;
     * Steps add a new language:
     * 1. Copy-paste the "NextLanguage = N" line above
     * 2. Increment "NextLanguage = N" to "NextLanguage = N+1"
     * 3. Replace "NextLanguage = N" with the name of the new language.
     * 4. Move the new language to the correct line above using alphabetical order
     * 5. (optional) Add a brief comment behind the language if the name is not self-explanatory
     *
     * @generated from enum value: Zig = 38;
     */
    Language[Language["Zig"] = 38] = "Zig";
})(Language || (Language = {}));
/**
 * Describes the enum scip.Language.
 */
export const LanguageSchema = /*@__PURE__*/ enumDesc(file_scip, 7);
