// CI guard: application SQL stays portable; backend-specific operations belong
// in src/db/query.ts, where their implementations and contract tests live.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { schema } from "../src/schema";

const keywords = new Set(
	"select from where in not exists filter over partition values conflict on as case when then else end distinct recursive with and or having by returning set update insert into delete join left inner cross union all limit offset order group using table primary key check references cast materialized".split(
		" ",
	),
);
const functions = new Set(
	"count sum min max avg coalesce nullif lower upper length char_length replace abs round floor ceil ceiling ln power row_number rank dense_rank lag lead now date_trunc to_char split_part regexp_replace array_to_string array_length".split(
		" ",
	),
);
const backendFunctions = new Set(
	"any all unnest generate_series extract position make_interval bool_or greatest least json_agg jsonb_agg json_build_object jsonb_build_object jsonb_set array_agg json_each json_group_array json_object json_array json_insert json_set json_patch regexp_matches regexp_matches_json".split(
		" ",
	),
);
const tables = new Set(Object.keys(schema.tables));

export function checkQueries(filename: string, source: string): string[] {
	const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
	const errors: string[] = [];
	const report = (node: ts.Node, message: string) => {
		const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
		errors.push(`${filename}:${line + 1}: ${message}`);
	};
	function visit(node: ts.Node) {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "unsafe")
			report(node, "Native SQL belongs in src/db/, not application code");
		if (ts.isTaggedTemplateExpression(node) && /^(sql|tx|nested)$/.test(node.tag.getText(ast))) {
			const template = node.template;
			const text = ts.isNoSubstitutionTemplateLiteral(template)
				? template.text
				: template.head.text + template.templateSpans.map((span) => " __binding__ " + span.literal.text).join("");
			const tokens = (text.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\w+|::|->>|->|!~\*|~\*|!~|[^\s]/g) ?? [])
				.filter((token) => !token.startsWith("'") && !token.startsWith('"') && !token.startsWith("--") && !token.startsWith("/*"))
				.map((token) => token.toLowerCase());
			const ctes = new Set(tokens.filter((_, i) => tokens[i + 1] === "as" && tokens[i + 2] === "("));
			for (let i = 0; i < tokens.length; i++) {
				const token = tokens[i];
				if (
					["::", "->", "->>", "~", "~*", "!~", "!~*", "ilike", "interval"].includes(token) ||
					["lateral", "fetch"].includes(token) ||
					(token === "distinct" && tokens[i + 1] === "on") ||
					(token === "similar" && tokens[i + 1] === "to") ||
					(token === "array" && tokens[i + 1] === "[") ||
					(token === "@" && tokens[i + 1] === ">") ||
					(token === "<" && tokens[i + 1] === "@") ||
					(token === "&" && tokens[i + 1] === "&") ||
					(token === "for" && tokens[i + 1] === "update") ||
					(token === "is" && tokens.slice(i + 1, i + 4).includes("distinct"))
				)
					report(node, `Use a shared SQL helper for ${token}`);
				if (tokens[i + 1] === "(" && /^[a-z_]\w*$/.test(token) && token !== "__binding__") {
					if (backendFunctions.has(token)) report(node, `Use a shared SQL helper for ${token}()`);
					else if (!keywords.has(token) && !functions.has(token) && !tables.has(token) && !ctes.has(token))
						report(node, `Unregistered SQL function ${token}(); implement and test it in the database layer`);
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(ast);
	return [...new Set(errors)];
}

if (import.meta.main) {
	const root = resolve(import.meta.dir, "../src");
	const errors = [...new Bun.Glob("**/*.ts").scanSync({ cwd: root })]
		.filter((name) => !name.startsWith("db/") && !["db.ts", "sqlite.ts", "schema.ts"].includes(name))
		.flatMap((name) => checkQueries(`src/${name}`, readFileSync(resolve(root, name), "utf8")));
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	} else console.log("Application SQL portability checks passed");
}
