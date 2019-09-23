import { Session } from '@azure-tools/autorest-extension-base';
import * as OpenAPI from '@azure-tools/openapi';
import { values, length, items, ToDictionary, Dictionary } from '@azure-tools/linq';
import { CodeModel, HttpServer, ServerVariable, StringSchema, ChoiceSchema, XmlSerlializationFormat, ExternalDocumentation, ApiVersion, Deprecation, ChoiceValue, HttpModel, SetType } from '@azure-tools/codemodel';
import { StringFormat } from '@azure-tools/openapi';

export class Interpretations {
  getEnumChoices(schema: OpenAPI.Schema): Array<ChoiceValue> {
    return values(schema.enum).select(each => SetType(ChoiceValue, {
      //  $type: 'ChoiceValue',
      value: each,
      name: '-each',
      description: 'description'
    })).toArray()

  }
  getXmlSerialization(schema: OpenAPI.Schema): XmlSerlializationFormat | undefined {
    return undefined;
  }
  getExternalDocs(schema: OpenAPI.Schema): ExternalDocumentation | undefined {
    return undefined;
  }
  getExample(schema: OpenAPI.Schema): any {
    return {};
  }
  getApiVersions(schema: OpenAPI.Schema): ApiVersion[] | undefined {
    if (schema['x-ms-metadata'] && schema['x-ms-metadata']['apiVersions']) {
      const v = values(<Array<string>>schema['x-ms-metadata']['apiVersions']).select(each => SetType(ApiVersion, {
        version: each.replace(/^-/, '').replace(/\+$/, ''),
        range: each.startsWith('-') ? <any>'-' : each.endsWith('+') ? '+' : undefined
      })).toArray();
      return v;
    }
    return undefined;
  }
  getDeprecation(schema: OpenAPI.Schema): Deprecation | undefined {
    if (schema.deprecated) {
      // todo
    }
    return undefined;
  }

  constructor(private session: Session<OpenAPI.Model>, private codeModel: CodeModel) {
  }

  xmsMeta(obj: any, key: string) {
    const m = obj['x-ms-metadata'];
    return m ? m[key] : undefined;
  }

  splitOpId(opId: string) {
    const p = opId.indexOf('_');

    return p != -1 ? {
      group: opId.substr(0, p),
      member: opId.substr(p + 1)
    } : {
        group: '',
        member: opId
      }
  }

  isStreamSchema(schema: OpenAPI.Schema) {
    return (schema.format === StringFormat.Binary || 'file');
  }

  getOperationId(httpMethod: string, path: string, original: OpenAPI.HttpOperation) {
    if (original.operationId) {
      return this.splitOpId(original.operationId);
    }

    // synthesize from tags.
    if (original.tags && length(original.tags) > 0) {

      switch (length(original.tags)) {
        case 0:
          break;
        case 1:
          this.session.warning(`Generating 'operationId' for '${httpMethod}' operation on path '${path}' `, ['Interpretations'], original);
          return this.splitOpId(`${original.tags[0]}`);
      }
      this.session.warning(`Generating 'operationId' for '${httpMethod}' operation on path '${path}' `, ['Interpretations'], original);
      return this.splitOpId(`${original.tags[0]}_${original.tags[1]}`);
    }
    this.session.error(`NEED 'operationId' for '${httpMethod}' operation on path '${path}' `, ['Interpretations'], original);

    return this.splitOpId('unknown-method');
  }


  getDescription(defaultValue: string, original: OpenAPI.Extensions & { title?: string; summary?: string; description?: string }): string {
    if (original) {
      return original.description || original.title || original.summary || defaultValue;
    }
    return defaultValue;
  }

  getName(defaultValue: string, original: any): string {
    return (original['x-ms-metadata'] && original['x-ms-metadata']['name']) ? original['x-ms-metadata']['name'] : defaultValue;
  }

  /** gets the operation path from metadata, falls back to the OAI3 path key */
  getPath(pathItem: OpenAPI.PathItem, operation: OpenAPI.HttpOperation, path: string) {
    return this.xmsMeta(pathItem, 'path') || this.xmsMeta(operation, 'path') || path;
  }

  /** creates server entries that are kept in the codeModel.protocol.http, and then referenced in each operation
   * 
   * @note - this is where deduplication of server entries happens.
    */
  getServers(operation: OpenAPI.HttpOperation): Array<HttpServer> {

    return values(operation.servers).select(server => {
      const p = <HttpModel>this.codeModel.protocol.http;
      const f = p && p.servers.find(each => each.url === server.url)
      if (f) {
        return f;
      }
      const s = new HttpServer(server.url, this.getDescription('MISSING-SERVER-DESCRIPTION', server));
      if (server.variables && length(server.variables) > 0) {
        s.variables = items(server.variables).select(each => {
          const description = this.getDescription("MISSING-SERVER_VARIABLE-DESCRIPTION", each.value)

          const variable = each.value;

          const schema = variable.enum ?
            this.getEnumSchemaForVarible(each.key, variable) :
            this.codeModel.schemas.addPrimitive(new StringSchema(`ServerVariable/${each.key}`, description));

          const serverVariable = new ServerVariable(
            each.key,
            this.getDescription("MISSING-SERVER_VARIABLE-DESCRIPTION", variable),
            schema,
            {
              default: variable.default,
              // required:  TODO: implement required on server variables
            });
          return serverVariable;
        }).toArray();
      }

      (<HttpModel>this.codeModel.protocol.http).servers.push(s);
      return s;

    }).toArray()
  }


  getEnumSchemaForVarible(name: string, somethingWithEnum: { enum?: Array<string> }): ChoiceSchema {
    return new ChoiceSchema(name, this.getDescription("MISSING-SERVER-VARIABLE-ENUM-DESCRIPTION", somethingWithEnum))
  }

  getExtensionProperties(dictionary: Dictionary<any>): Dictionary<any> {
    return Interpretations.getExtensionProperties(dictionary);
  }
  static getExtensionProperties(dictionary: Dictionary<any>): Dictionary<any> {
    const result = ToDictionary(OpenAPI.includeXDash(dictionary), each => dictionary[each]);
    result['x-ms-metadata'] = undefined;
    return result;
  }
}
