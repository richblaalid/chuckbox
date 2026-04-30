import nextConfig from "eslint-config-next";

/**
 * Custom rule: ban `.single()` on a chain that includes `.from('unit_memberships')`.
 *
 * The multi-unit page refactor (see plans/multi-unit-page-refactor.md) replaced
 * every inline `.from('unit_memberships').single()` with `getCurrentMembership(unit)`
 * from `@/lib/data/cached-queries` (or `@/lib/auth` for API routes).
 *
 * `.single()` on `unit_memberships` is unsafe for multi-unit users — it errors
 * when a user has multiple active memberships, or silently picks an arbitrary
 * row. This rule prevents regression.
 *
 * Escape hatch: `// eslint-disable-next-line custom/no-single-on-unit-memberships`
 * (only valid case is the helper implementations themselves, which currently
 * don't use `.single()` either, so no exemptions needed today).
 */
const noSingleOnUnitMemberships = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow .single() on a chain that includes .from('unit_memberships'); use getCurrentMembership() helper instead.",
    },
    schema: [],
    messages: {
      avoid:
        "Avoid `.single()` on `unit_memberships`. Use `getCurrentMembership(unit)` from `@/lib/data/cached-queries` (pages/server actions) or `@/lib/auth` (API routes). See plans/multi-unit-page-refactor.md.",
    },
  },
  create(context) {
    return {
      "CallExpression[callee.type='MemberExpression'][callee.property.name='single']"(
        node
      ) {
        // Walk down the chain object to look for `.from('unit_memberships')`.
        let current = node.callee.object;
        while (current && current.type === "CallExpression") {
          const callee = current.callee;
          if (
            callee &&
            callee.type === "MemberExpression" &&
            callee.property &&
            callee.property.name === "from" &&
            current.arguments.length > 0 &&
            current.arguments[0].type === "Literal" &&
            current.arguments[0].value === "unit_memberships"
          ) {
            context.report({ node, messageId: "avoid" });
            return;
          }
          current = callee && callee.type === "MemberExpression" ? callee.object : null;
        }
      },
    };
  },
};

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [".next/*", "node_modules/*", "tests/fixtures/lint/*"],
  },
  {
    plugins: {
      custom: {
        rules: {
          "no-single-on-unit-memberships": noSingleOnUnitMemberships,
        },
      },
    },
    rules: {
      "custom/no-single-on-unit-memberships": "error",
    },
  },
];

export default eslintConfig;
