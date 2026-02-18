import { LazyQueryExecFunction } from "@apollo/client";
import { RuleObject } from "antd/lib/form";
import { ValidateSparkSchemaDDLVariables } from "gqlqueries/dataSources";

export const schemaValidator =
  (validator: LazyQueryExecFunction<void, ValidateSparkSchemaDDLVariables>) =>
  async (_: RuleObject, value: string) => {
    if (!value) {
      throw new Error("Schema is required");
    }
    try {
      const { error } = await validator({
        variables: { sparkSchemaDDL: value },
      });
      if (error) {
        throw error;
      }
    } catch {
      throw new Error("Invalid schema");
    }
  };

//   Usage in form
// <Form.Item name="schema" rules={[{ validator: schemaValidator(validateQuery) }]}>
//   <TextArea rows={10} />
// </Form.Item>
