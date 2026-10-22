(() => {
    "use strict";

    const state = {
        schema: [],
        analysis: null,
        activeSource: null,
        cy: null,
        selectedTable: null,
        profileRequestId: 0,
        lastUpdated: null,
        docLoaded: false,
        currentView: "overview",
        explorerMode: "table",
        analysisSeverity: "all",
        analysisGrouping: "rule",
        markdown: "",
        migrationSql: "",
        migrationRequestId: 0,
        diagramSchema: [],
        diagramDefinitions: [],
        activeDiagram: "er",
        diagramTimer: null,
        diagramSql: "",
        diagramDialect: "sqlite",
        dashboardSqlTimer: null,
        sqlImportRevision: 0
    };

    const icons = {
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/></svg>',
        issue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
        table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v14H4zM4 9h16M9 9v10M14 9v10"/></svg>',
        database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v13c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>'
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));

    const diagramCatalog = [
        ["er", "ER diagram"],
        ["usecase", "Use-case"],
        ["object", "Object"],
        ["package", "Package"],
        ["state", "State transition"],
        ["activity", "Activity"],
        ["dfd0", "DFD · Level 0"],
        ["dfd1", "DFD · Level 1"],
        ["dfd2", "DFD · Level 2"]
    ];

    function splitSqlStatements(sql) {
        const statements = [];
        let statement = "";
        let quote = "";
        let depth = 0;
        for (let index = 0; index < sql.length; index += 1) {
            const char = sql[index];
            const next = sql[index + 1];
            if (!quote && char === "-" && next === "-") {
                while (index < sql.length && sql[index] !== "\n") index += 1;
                statement += "\n";
                continue;
            }
            if (!quote && char === "/" && next === "*") {
                index += 2;
                while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
                index += 1;
                statement += " ";
                continue;
            }
            if (quote) {
                statement += char;
                if (char === quote) {
                    if (next === quote && quote !== "]") {
                        statement += next;
                        index += 1;
                    } else {
                        quote = "";
                    }
                } else if (quote === "]" && char === "]") {
                    quote = "";
                }
                continue;
            }
            if (char === "'" || char === '"' || char === "`") {
                quote = char;
                statement += char;
                continue;
            }
            if (char === "[") {
                quote = "]";
                statement += char;
                continue;
            }
            if (char === "(") depth += 1;
            if (char === ")") depth = Math.max(0, depth - 1);
            if (char === ";" && depth === 0) {
                if (statement.trim()) statements.push(statement.trim());
                statement = "";
            } else {
                statement += char;
            }
        }
        if (statement.trim()) statements.push(statement.trim());
        return statements;
    }

    function splitSqlList(value) {
        const items = [];
        let start = 0;
        let depth = 0;
        let quote = "";
        for (let index = 0; index < value.length; index += 1) {
            const char = value[index];
            const next = value[index + 1];
            if (quote) {
                if (char === quote) {
                    if (next === quote && quote !== "]") index += 1;
                    else quote = "";
                } else if (quote === "]" && char === "]") quote = "";
                continue;
            }
            if (char === "'" || char === '"' || char === "`") quote = char;
            else if (char === "[") quote = "]";
            else if (char === "(") depth += 1;
            else if (char === ")") depth -= 1;
            else if (char === "," && depth === 0) {
                items.push(value.slice(start, index).trim());
                start = index + 1;
            }
        }
        if (value.slice(start).trim()) items.push(value.slice(start).trim());
        return items;
    }

    function unquoteIdentifier(value) {
        const name = value.trim();
        if ((name.startsWith('"') && name.endsWith('"'))
            || (name.startsWith("`") && name.endsWith("`"))
            || (name.startsWith("[") && name.endsWith("]"))) {
            return name.slice(1, -1).replace(/""/g, '"').replace(/``/g, "`");
        }
        return name;
    }

    function sqlBody(statement, openingIndex) {
        let depth = 0;
        let quote = "";
        for (let index = openingIndex; index < statement.length; index += 1) {
            const char = statement[index];
            const next = statement[index + 1];
            if (quote) {
                if (char === quote) {
                    if (next === quote && quote !== "]") index += 1;
                    else quote = "";
                } else if (quote === "]" && char === "]") quote = "";
                continue;
            }
            if (char === "'" || char === '"' || char === "`") quote = char;
            else if (char === "[") quote = "]";
            else if (char === "(") depth += 1;
            else if (char === ")" && --depth === 0) return statement.slice(openingIndex + 1, index);
        }
        throw new Error("A CREATE statement has an unclosed parenthesis.");
    }

    function parseSqlSchema(sql) {
        if (sql.length > 200000) throw new Error("SQL input is limited to 200,000 characters.");
        const statements = splitSqlStatements(sql);
        const tables = new Map();
        const indexes = [];
        let ignoredStatements = 0;
        for (const statement of statements) {
            const tableMatch = statement.match(/^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]+\]|[\w.$-]+)\s*\()/i);
            if (tableMatch) {
                const openingIndex = statement.indexOf("(", tableMatch.index + tableMatch[0].length - 1);
                const tableName = unquoteIdentifier(tableMatch[1].trim().replace(/\($/, ""));
                if (!tableName || tables.has(tableName)) throw new Error(`The SQL contains a duplicate or empty table name: ${tableName || "(empty)"}.`);
                const table = { name: tableName, columns: [], foreign_keys: [], indexes: [], _uniqueConstraints: [] };
                const definitions = splitSqlList(sqlBody(statement, openingIndex));
                const primaryKeyColumns = [];
                for (const definition of definitions) {
                    const upper = definition.trim().toUpperCase();
                    const tableConstraint = /^(?:CONSTRAINT\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s+)?(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(definition);
                    if (tableConstraint) {
                        const primary = definition.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
                        if (primary) primaryKeyColumns.push(...splitSqlList(primary[1]).map(unquoteIdentifier));
                        const foreign = definition.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w.$-]+))\s*\(([^)]+)\)/i);
                        if (foreign) {
                            const sourceColumns = splitSqlList(foreign[1]).map(unquoteIdentifier);
                            const targetColumns = splitSqlList(foreign[3]).map(unquoteIdentifier);
                            sourceColumns.forEach((from, index) => table.foreign_keys.push({
                                from,
                                to_table: unquoteIdentifier(foreign[2]),
                                to_column: targetColumns[index] || "",
                                on_update: (definition.match(/ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i) || [])[1] || "NO ACTION",
                                on_delete: (definition.match(/ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i) || [])[1] || "NO ACTION"
                            }));
                        }
                        const unique = definition.match(/UNIQUE\s*\(([^)]+)\)/i);
                        if (unique) table._uniqueConstraints.push(splitSqlList(unique[1]).map(unquoteIdentifier));
                        continue;
                    }
                    const columnMatch = definition.match(/^("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]+\]|[^\s]+)\s*([\s\S]*)$/);
                    if (!columnMatch) continue;
                    const columnName = unquoteIdentifier(columnMatch[1]);
                    const remainder = columnMatch[2].trim();
                    const type = (remainder.split(/\b(?:PRIMARY\s+KEY|NOT\s+NULL|NULL|UNIQUE|CHECK|DEFAULT|REFERENCES|COLLATE|GENERATED|AUTO_INCREMENT|AUTOINCREMENT)\b/i)[0] || "").trim();
                    const defaultMatch = remainder.match(/\bDEFAULT\s+((?:'(?:(?:'')|[^'])*'|"(?:""|[^"])*"|[^\s,]+))/i);
                    const column = {
                        name: columnName,
                        type,
                        notnull: /\bNOT\s+NULL\b/i.test(remainder),
                        default: defaultMatch ? defaultMatch[1] : null,
                        pk: /\bPRIMARY\s+KEY\b/i.test(remainder)
                    };
                    table.columns.push(column);
                    if (column.pk) primaryKeyColumns.push(columnName);
                    if (/\bUNIQUE\b/i.test(remainder)) table._uniqueConstraints.push([columnName]);
                    const inlineForeign = remainder.match(/\bREFERENCES\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w.$-]+))\s*\(([^)]+)\)/i);
                    if (inlineForeign) table.foreign_keys.push({
                        from: columnName,
                        to_table: unquoteIdentifier(inlineForeign[1]),
                        to_column: unquoteIdentifier(splitSqlList(inlineForeign[2])[0] || ""),
                        on_update: (remainder.match(/ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i) || [])[1] || "NO ACTION",
                        on_delete: (remainder.match(/ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i) || [])[1] || "NO ACTION"
                    });
                    if (upper.includes("PRIMARY KEY") && !primaryKeyColumns.includes(columnName)) primaryKeyColumns.push(columnName);
                }
                primaryKeyColumns.forEach((name) => {
                    const column = table.columns.find((item) => item.name === name);
                    if (column) column.pk = true;
                });
                tables.set(tableName, table);
                continue;
            }
            const indexMatch = statement.match(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w.$-]+))\s+ON\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w.$-]+))\s*\(/i);
            if (indexMatch) {
                const openingIndex = statement.indexOf("(", indexMatch.index + indexMatch[0].length - 1);
                indexes.push({
                    name: unquoteIdentifier(indexMatch[2]),
                    table: unquoteIdentifier(indexMatch[3]),
                    columns: splitSqlList(sqlBody(statement, openingIndex)).map((column) => unquoteIdentifier(column.replace(/\s+(?:ASC|DESC)\s*$/i, ""))),
                    unique: Boolean(indexMatch[1])
                });
                continue;
            }
            ignoredStatements += 1;
        }
        indexes.forEach((index) => {
            const table = tables.get(index.table);
            if (table) table.indexes.push({ name: index.name, columns: index.columns, unique: index.unique, origin: "c", partial: false });
        });
        tables.forEach((table) => {
            table._uniqueConstraints.forEach((columns, index) => table.indexes.push({
                name: `unique_${table.name}_${index + 1}`,
                columns,
                unique: true,
                origin: "u",
                partial: false
            }));
            delete table._uniqueConstraints;
        });
        if (!tables.size) throw new Error("No CREATE TABLE statements were found. Paste SQL DDL such as CREATE TABLE ….");
        const unknownTargets = [];
        tables.forEach((table) => table.foreign_keys.forEach((foreignKey) => {
            if (!tables.has(foreignKey.to_table)) unknownTargets.push(`${table.name}.${foreignKey.from} → ${foreignKey.to_table}`);
        }));
        return { schema: Array.from(tables.values()), ignoredStatements, unknownTargets };
    }

    function makeDiagramDefinitions(schema) {
        const tableNames = schema.map((table) => table.name);
        const tableId = (name) => `table:${name}`;
        const relationEdges = schema.flatMap((table) => (table.foreign_keys || [])
            .filter((foreignKey) => tableNames.includes(foreignKey.to_table))
            .map((foreignKey) => ({
                from: tableId(table.name),
                to: tableId(foreignKey.to_table),
                label: foreignKey.from
            })));
        const nodesForTables = (tables) => tables.map((table) => ({
            id: tableId(table.name),
            label: table.name,
            kind: "entity",
            detail: `${(table.columns || []).length} columns`
        }));
        const capped = schema.slice(0, 10);
        const useCases = capped.flatMap((table) => ["Create", "Read", "Update", "Delete"].map((action) => ({
            id: `use:${action}:${table.name}`,
            label: `${action} ${table.name}`,
            kind: "usecase"
        })));
        const useCaseEdges = capped.flatMap((table) => ["Create", "Read", "Update", "Delete"].map((action) => ({
            from: "actor:user", to: `use:${action}:${table.name}`, label: ""
        })));
        const objectNodes = capped.map((table) => ({
            id: `object:${table.name}`,
            label: `${table.name} instance`,
            kind: "object",
            detail: (table.columns || []).slice(0, 3).map((column) => `${column.name}: ${column.type || "?"}`).join(" · ") || "No columns"
        }));
        const objectEdges = relationEdges.filter((edge) =>
            capped.some((table) => tableId(table.name) === edge.from)
            && capped.some((table) => tableId(table.name) === edge.to)
        ).map((edge) => ({
            from: `object:${edge.from.slice(6)}`,
            to: `object:${edge.to.slice(6)}`,
            label: edge.label
        }));
        const packages = new Map();
        schema.forEach((table) => {
            const prefix = table.name.includes("_") ? table.name.split("_")[0] : "core";
            if (!packages.has(prefix)) packages.set(prefix, []);
            packages.get(prefix).push(table);
        });
        const packageNodes = [];
        const packageEdges = [];
        packages.forEach((tables, prefix) => {
            const packageId = `package:${prefix}`;
            packageNodes.push({ id: packageId, label: `${prefix} package`, kind: "package", detail: `${tables.length} table${tables.length === 1 ? "" : "s"}` });
            tables.slice(0, 12).forEach((table) => {
                packageNodes.push({ id: `package-table:${table.name}`, label: table.name, kind: "entity", detail: `${(table.columns || []).length} columns` });
                packageEdges.push({ from: packageId, to: `package-table:${table.name}`, label: "contains" });
            });
        });
        const firstTable = schema[0];
        const lifecycleStates = ["New", "Validated", "Stored", "Updated", "Archived"];
        const stateNodes = lifecycleStates.map((label, index) => ({ id: `state:${index}`, label, kind: "state" }));
        const stateEdges = lifecycleStates.slice(0, -1).map((label, index) => ({
            from: `state:${index}`,
            to: `state:${index + 1}`,
            label: ["validate", "save", "edit", "archive"][index]
        }));
        const activitySteps = [
            { id: "activity:request", label: "Receive request", kind: "process" },
            { id: "activity:validate", label: "Validate required fields", kind: "process" },
            { id: "activity:decision", label: "Valid input?", kind: "decision" },
            { id: "activity:write", label: `Write ${firstTable ? firstTable.name : "record"}`, kind: "process" },
            { id: "activity:response", label: "Return result", kind: "process" }
        ];
        const activityEdges = [
            { from: "activity:request", to: "activity:validate" },
            { from: "activity:validate", to: "activity:decision" },
            { from: "activity:decision", to: "activity:write", label: "Yes" },
            { from: "activity:decision", to: "activity:response", label: "No" },
            { from: "activity:write", to: "activity:response" }
        ];
        const dfd0Nodes = [
            { id: "dfd0:actor", label: "External client / user", kind: "actor" },
            { id: "dfd0:process", label: "Database-backed application", kind: "process" },
            { id: "dfd0:store", label: "Database", kind: "store" }
        ];
        const dfd0Edges = [
            { from: "dfd0:actor", to: "dfd0:process", label: "Requests / responses" },
            { from: "dfd0:process", to: "dfd0:store", label: "Read / write data" }
        ];
        const dfd1Nodes = [
            { id: "dfd1:actor", label: "Client", kind: "actor" },
            { id: "dfd1:api", label: "1. API / request handling", kind: "process" },
            { id: "dfd1:validation", label: "2. Validation", kind: "process" },
            { id: "dfd1:operations", label: "3. Data operations", kind: "process" },
            { id: "dfd1:response", label: "4. Response", kind: "process" },
            ...capped.slice(0, 6).map((table) => ({ id: `dfd1:store:${table.name}`, label: `D${tableNames.indexOf(table.name) + 1} ${table.name}`, kind: "store" }))
        ];
        const dfd1Edges = [
            { from: "dfd1:actor", to: "dfd1:api", label: "Request" },
            { from: "dfd1:api", to: "dfd1:validation", label: "Input" },
            { from: "dfd1:validation", to: "dfd1:operations", label: "Validated data" },
            { from: "dfd1:operations", to: "dfd1:response", label: "Result" },
            ...capped.slice(0, 6).map((table) => ({ from: "dfd1:operations", to: `dfd1:store:${table.name}`, label: "Read / write" })),
            { from: "dfd1:response", to: "dfd1:actor", label: "Response" }
        ];
        const primary = schema[0];
        const dfd2Nodes = [
            { id: "dfd2:client", label: "Client", kind: "actor" },
            { id: "dfd2:receive", label: "2.1 Receive request", kind: "process" },
            { id: "dfd2:validate", label: "2.2 Validate fields", kind: "process" },
            { id: "dfd2:read", label: `2.3 Read ${primary.name}`, kind: "process" },
            { id: "dfd2:write", label: `2.4 Create / update ${primary.name}`, kind: "process" },
            { id: "dfd2:store", label: `D1 ${primary.name}`, kind: "store" },
            { id: "dfd2:return", label: "2.5 Return result", kind: "process" }
        ];
        const dfd2Edges = [
            { from: "dfd2:client", to: "dfd2:receive", label: "Request" },
            { from: "dfd2:receive", to: "dfd2:validate", label: "Input" },
            { from: "dfd2:validate", to: "dfd2:read", label: "Valid" },
            { from: "dfd2:read", to: "dfd2:store", label: "Query" },
            { from: "dfd2:write", to: "dfd2:store", label: "Insert / update" },
            { from: "dfd2:validate", to: "dfd2:write", label: "Accepted" },
            { from: "dfd2:read", to: "dfd2:return", label: "Data" },
            { from: "dfd2:return", to: "dfd2:client", label: "Response" }
        ];
        const diagrams = [
            { id: "er", title: "ER diagram", inferred: false, nodes: nodesForTables(capped), edges: relationEdges, summary: `${schema.length} entities and ${relationEdges.length} declared foreign-key relationships. Directly based on parsed table and foreign-key definitions.`, details: ["Each entity is a SQL table.", "Connectors are explicit FOREIGN KEY constraints.", "Index metadata is listed in the schema summary, not interpreted as a relationship."] },
            { id: "usecase", title: "Use-case diagram", inferred: true, nodes: [{ id: "actor:user", label: "User / client", kind: "actor" }, ...useCases], edges: useCaseEdges, summary: `Illustrative CRUD use cases for ${Math.min(schema.length, 10)} tables. SQL does not define real actors, permissions, or application features.`, details: ["CRUD actions are inferred as possible database operations.", "The user/client actor is a generic placeholder.", "Replace these assumptions with application requirements for an accurate use-case model."] },
            { id: "object", title: "Object diagram", inferred: true, nodes: objectNodes, edges: objectEdges, summary: `Illustrative object instances using table fields as attributes across ${objectNodes.length} tables. No row data is read.`, details: ["Each box is a hypothetical instance, not a retrieved database row.", "Attributes are drawn from column names and SQL types.", "Links mirror declared foreign keys; actual object values are unknown."] },
            { id: "package", title: "Package diagram", inferred: true, nodes: packageNodes.slice(0, 28), edges: packageEdges.slice(0, 14), summary: `Tables grouped into ${packages.size} inferred packages using shared name prefixes; tables without prefixes go into core.`, details: ["SQL has no application module boundaries.", "Prefixes such as order_items suggest a grouping, not proof of code ownership.", "Foreign-key dependencies are shown in the ER diagram."] },
            { id: "state", title: "State transition diagram", inferred: true, nodes: stateNodes, edges: stateEdges, summary: "A generic record lifecycle is inferred because schema DDL does not specify business states or transition rules.", details: ["New → Validated → Stored → Updated → Archived is illustrative.", "Status columns and their allowed values are not inferred as workflow rules.", "Add application-level transition rules for an accurate state machine."] },
            { id: "activity", title: "Activity diagram", inferred: true, nodes: activitySteps, edges: activityEdges, summary: "An illustrative request-validation-write flow is derived from the existence of tables.", details: ["The yes/no branch demonstrates a generic validation decision.", "Actual validation rules, service calls, and error handling are not present in DDL.", "The first SQL table is used as an example data target."] },
            { id: "dfd0", title: "DFD · Level 0", inferred: true, nodes: dfd0Nodes, edges: dfd0Edges, summary: "Context view showing an external client, a database-backed application, and the database as a single store.", details: ["The system boundary is conceptual; SQL does not define deployed services.", "External actor and request/response flows are placeholders.", "Database existence and tables come from SQL."] },
            { id: "dfd1", title: "DFD · Level 1", inferred: true, nodes: dfd1Nodes, edges: dfd1Edges, summary: `Breakdown into generic request, validation, data-operation, and response processes with up to six data stores.`, details: ["Process boundaries are inferred and should be validated against application architecture.", "Data stores correspond to the first six tables.", "Data flows are generic read/write interactions, not observed queries."] },
            { id: "dfd2", title: "DFD · Level 2", inferred: true, nodes: dfd2Nodes, edges: dfd2Edges, summary: `Detailed illustrative request flow using ${primary.name} as the example data store.`, details: ["The first table is selected as the Level 2 example.", "Operations are conceptual; no query log or application source is inspected.", "Foreign-key constraints are shown in the ER view."] }
        ];
        return diagrams;
    }

    function wrapSvgText(text, maxCharacters) {
        const words = String(text).split(/\s+/);
        const lines = [];
        let line = "";
        words.forEach((word) => {
            if (line && `${line} ${word}`.length > maxCharacters) {
                lines.push(line);
                line = word;
            } else {
                line = line ? `${line} ${word}` : word;
            }
        });
        if (line) lines.push(line);
        return lines.slice(0, 3);
    }

    function diagramNodePositions(nodes) {
        const width = 980;
        const height = 560;
        const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.35)));
        const rows = Math.max(1, Math.ceil(nodes.length / columns));
        const cellWidth = width / columns;
        const cellHeight = height / rows;
        return new Map(nodes.map((node, index) => [
            node.id,
            { x: 25 + (index % columns) * cellWidth + cellWidth / 2, y: 25 + Math.floor(index / columns) * cellHeight + cellHeight / 2 }
        ]));
    }

    function renderDiagramSvg(diagram) {
        if (!diagram.nodes.length) return '<div class="empty-state">This diagram has no elements for the parsed schema.</div>';
        const width = 1000;
        const height = 610;
        const positions = diagramNodePositions(diagram.nodes);
        const edges = diagram.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return "";
            const middleX = (from.x + to.x) / 2;
            const middleY = (from.y + to.y) / 2 - 12;
            return `<g><path d="M${from.x} ${from.y} Q${middleX} ${middleY} ${to.x} ${to.y}" fill="none" stroke="#a8b8cf" stroke-width="1.7" marker-end="url(#diagram-arrow)"/>${edge.label ? `<text x="${middleX}" y="${middleY - 5}" text-anchor="middle" fill="#8595aa" font-size="10">${escapeHtml(edge.label)}</text>` : ""}</g>`;
        }).join("");
        const nodes = diagram.nodes.map((node) => {
            const point = positions.get(node.id);
            const lines = wrapSvgText(node.label, 20);
            const isUseCase = node.kind === "usecase";
            const isActor = node.kind === "actor";
            const isDecision = node.kind === "decision";
            const shape = isUseCase
                ? `<ellipse cx="${point.x}" cy="${point.y}" rx="83" ry="29" fill="#f4f0ff" stroke="#b5a0ec" stroke-width="1.6"/>`
                : isActor
                    ? `<rect x="${point.x - 84}" y="${point.y - 28}" width="168" height="56" rx="24" fill="#eaf8f1" stroke="#89d4b2" stroke-width="1.6"/>`
                    : isDecision
                        ? `<path d="M${point.x} ${point.y - 36} l82 36 -82 36 -82-36Z" fill="#fff5e4" stroke="#e8bf77" stroke-width="1.6"/>`
                        : `<rect x="${point.x - 86}" y="${point.y - 32}" width="172" height="64" rx="9" fill="${node.kind === "store" ? "#e9f7f4" : node.kind === "object" ? "#fff4e8" : "#edf3ff"}" stroke="${node.kind === "store" ? "#79c7b0" : node.kind === "object" ? "#edc18d" : "#9bb9ef"}" stroke-width="1.6"/>`;
            const labelY = point.y - ((lines.length - 1) * 6);
            const text = lines.map((line, index) => `<text x="${point.x}" y="${labelY + index * 14}" text-anchor="middle" fill="#334d6c" font-size="11" font-weight="600">${escapeHtml(line)}</text>`).join("");
            const detail = node.detail ? `<text x="${point.x}" y="${point.y + 20}" text-anchor="middle" fill="#8192a8" font-size="9">${escapeHtml(wrapSvgText(node.detail, 23)[0] || "")}</text>` : "";
            return `<g>${shape}${text}${detail}</g>`;
        }).join("");
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(diagram.title)}"><defs><marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10Z" fill="#8298b6"/></marker></defs><rect width="${width}" height="${height}" fill="transparent"/>${edges}${nodes}</svg>`;
    }

    function renderActiveDiagram() {
        const diagram = state.diagramDefinitions.find((item) => item.id === state.activeDiagram);
        if (!diagram) return;
        $$(".diagram-tab", $("#diagramTabs")).forEach((tab) => {
            const active = tab.dataset.diagramId === diagram.id;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", String(active));
        });
        $("#diagramStage").innerHTML = renderDiagramSvg(diagram);
        $("#diagramDescription").innerHTML = `
            <h3>${escapeHtml(diagram.title)}${diagram.inferred ? ' <span class="tag">INFERRED</span>' : ' <span class="tag">FROM SQL</span>'}</h3>
            <p>${escapeHtml(diagram.summary)}</p>
            <ul>${diagram.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>`;
    }

    function generateDiagrams() {
        const sql = $("#diagramSqlInput").value.trim();
        if (!sql) {
            state.diagramSchema = [];
            state.diagramDefinitions = [];
            $("#diagramStage").innerHTML = '<div class="empty-state">Paste CREATE TABLE statements to generate diagrams.</div>';
            $("#diagramTabs").innerHTML = "";
            $("#diagramCounts").innerHTML = "";
            $("#diagramDescription").innerHTML = "<h3>What this diagram shows</h3><p>Generated diagrams and their analysis will appear here.</p>";
            $("#diagramTableCount").textContent = "0 tables";
            $("#downloadDiagramPdf").disabled = true;
            $("#diagramParseStatus").textContent = "Waiting for SQL";
            $("#diagramParseStatus").classList.remove("attention");
            return;
        }
        try {
            const result = parseSqlSchema(sql);
            state.diagramSchema = result.schema;
            state.diagramSql = sql;
            state.diagramDialect = $("#diagramDialect").value;
            state.diagramDefinitions = makeDiagramDefinitions(result.schema);
            if (!state.diagramDefinitions.some((diagram) => diagram.id === state.activeDiagram)) state.activeDiagram = "er";
            $("#diagramTableCount").textContent = `${result.schema.length} tables`;
            const columns = result.schema.reduce((sum, table) => sum + table.columns.length, 0);
            const relationships = result.schema.reduce((sum, table) => sum + table.foreign_keys.length, 0);
            const indexes = result.schema.reduce((sum, table) => sum + table.indexes.length, 0);
            $("#diagramCounts").innerHTML = `<span class="tag">${result.schema.length} tables</span><span class="tag">${columns} columns</span><span class="tag">${relationships} relationships</span><span class="tag">${indexes} indexes</span>`;
            $("#diagramTabs").innerHTML = state.diagramDefinitions.map((diagram) =>
                `<button type="button" class="diagram-tab" role="tab" aria-selected="false" data-diagram-id="${diagram.id}">${escapeHtml(diagram.title)}</button>`
            ).join("");
            $$(".diagram-tab", $("#diagramTabs")).forEach((tab) => tab.addEventListener("click", () => {
                state.activeDiagram = tab.dataset.diagramId;
                renderActiveDiagram();
            }));
            $("#diagramTabs").hidden = false;
            $("#downloadDiagramPdf").disabled = false;
            $("#diagramParseStatus").textContent = "Schema parsed";
            $("#diagramParseStatus").classList.remove("attention");
            const messages = [];
            if (result.ignoredStatements) messages.push(`${result.ignoredStatements} non-schema statement${result.ignoredStatements === 1 ? "" : "s"} excluded from diagram parsing; supported data statements remain available in the workspace.`);
            if (result.unknownTargets.length) messages.push(`Unresolved foreign-key targets: ${result.unknownTargets.join(", ")}.`);
            $("#diagramProgress").textContent = messages.join(" ");
            renderActiveDiagram();
        } catch (error) {
            state.diagramSchema = [];
            state.diagramDefinitions = [];
            $("#diagramTableCount").textContent = "Schema error";
            $("#diagramTabs").innerHTML = "";
            $("#diagramCounts").innerHTML = "";
            $("#diagramStage").innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
            $("#diagramDescription").innerHTML = "<h3>SQL could not be parsed</h3><p>Check CREATE TABLE and CREATE INDEX syntax, then try again.</p>";
            $("#downloadDiagramPdf").disabled = true;
            $("#diagramParseStatus").textContent = "Parse error";
            $("#diagramParseStatus").classList.add("attention");
            $("#diagramProgress").textContent = "";
        }
    }

    function wrapReportLine(value, maxLength = 150) {
        const words = String(value).split(/\s+/);
        const lines = [];
        let line = "";
        words.forEach((word) => {
            if (line && `${line} ${word}`.length > maxLength) {
                lines.push(line);
                line = word;
            } else {
                line = line ? `${line} ${word}` : word;
            }
        });
        if (line) lines.push(line);
        return lines.length ? lines : [""];
    }

    function createReportTextCanvas(title, subtitle, lines) {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 850;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not create a PDF report page.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#19304f";
        context.font = "700 30px Arial";
        context.fillText(title, 54, 66, 1090);
        context.fillStyle = "#71839b";
        context.font = "16px Arial";
        context.fillText(subtitle, 56, 97, 1090);
        context.strokeStyle = "#e4ebf4";
        context.beginPath();
        context.moveTo(54, 118);
        context.lineTo(1146, 118);
        context.stroke();
        let y = 151;
        lines.forEach((item) => {
            if (item === "") {
                y += 10;
                return;
            }
            const heading = item.startsWith("## ");
            const bullet = item.startsWith("- ");
            const value = item.replace(/^##\s+|^-\s+/, "");
            const wrapped = wrapReportLine(value, heading ? 80 : 145);
            context.fillStyle = heading ? "#315a91" : "#405670";
            context.font = heading ? "700 17px Arial" : bullet ? "14px Arial" : "13px Arial";
            wrapped.forEach((line, index) => {
                const prefix = bullet && index === 0 ? "•  " : bullet ? "   " : "";
                context.fillText(prefix + line, heading ? 57 : 65, y, 1080);
                y += heading ? 24 : 19;
            });
            if (y > 780) y = 780;
        });
        context.fillStyle = "#93a1b4";
        context.font = "11px Arial";
        context.fillText("SchemaSphere · Generated from supplied SQL DDL · Inferred behavior diagrams are illustrative", 56, 820, 1080);
        return canvas;
    }

    function createDiagramReportCanvas(diagram) {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 850;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not create a diagram report page.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#19304f";
        context.font = "700 27px Arial";
        context.fillText(diagram.title, 52, 55, 950);
        context.fillStyle = diagram.inferred ? "#9a6b19" : "#157c61";
        context.font = "700 12px Arial";
        context.fillText(diagram.inferred ? "INFERRED FROM STRUCTURE — ILLUSTRATIVE" : "BASED ON DECLARED SQL TABLES AND FOREIGN KEYS", 55, 82, 1050);
        context.fillStyle = "#687c96";
        context.font = "14px Arial";
        wrapReportLine(diagram.summary, 150).forEach((line, index) => context.fillText(line, 55, 112 + index * 19, 1080));

        const nodes = diagram.nodes.slice(0, 16);
        const edges = diagram.edges.filter((edge) =>
            nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to)
        ).slice(0, 28);
        const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.4)));
        const rows = Math.max(1, Math.ceil(nodes.length / columns));
        const gridWidth = 1080;
        const gridHeight = 500;
        const startX = 60;
        const startY = 185;
        const cellWidth = gridWidth / columns;
        const cellHeight = gridHeight / rows;
        const positions = new Map(nodes.map((node, index) => [
            node.id,
            { x: startX + (index % columns + .5) * cellWidth, y: startY + (Math.floor(index / columns) + .5) * cellHeight }
        ]));
        context.lineWidth = 2;
        context.strokeStyle = "#b3c0d1";
        context.fillStyle = "#7689a2";
        context.font = "11px Arial";
        edges.forEach((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            context.beginPath();
            context.moveTo(to.x, to.y);
            context.lineTo(to.x - 9 * Math.cos(angle - Math.PI / 6), to.y - 9 * Math.sin(angle - Math.PI / 6));
            context.lineTo(to.x - 9 * Math.cos(angle + Math.PI / 6), to.y - 9 * Math.sin(angle + Math.PI / 6));
            context.closePath();
            context.fill();
            if (edge.label) {
                context.fillStyle = "#6d8099";
                context.fillText(edge.label.slice(0, 24), (from.x + to.x) / 2, (from.y + to.y) / 2 - 5, 120);
                context.fillStyle = "#7689a2";
            }
        });
        nodes.forEach((node) => {
            const point = positions.get(node.id);
            const boxWidth = Math.min(220, Math.max(150, cellWidth - 26));
            const boxHeight = 62;
            context.beginPath();
            if (node.kind === "usecase") context.ellipse(point.x, point.y, boxWidth / 2, boxHeight / 2, 0, 0, Math.PI * 2);
            else if (node.kind === "actor") {
                context.roundRect(point.x - boxWidth / 2, point.y - boxHeight / 2, boxWidth, boxHeight, 25);
            } else context.roundRect(point.x - boxWidth / 2, point.y - boxHeight / 2, boxWidth, boxHeight, 8);
            context.fillStyle = node.kind === "usecase" ? "#f4f0ff" : node.kind === "actor" ? "#eaf8f1" : node.kind === "store" ? "#e8f7f3" : "#edf3ff";
            context.fill();
            context.strokeStyle = node.kind === "usecase" ? "#b5a0ec" : node.kind === "actor" ? "#89d4b2" : node.kind === "store" ? "#79c7b0" : "#9bb9ef";
            context.lineWidth = 2;
            context.stroke();
            context.fillStyle = "#334d6c";
            context.font = "600 13px Arial";
            const labelLines = wrapReportLine(node.label, 23).slice(0, 2);
            labelLines.forEach((line, index) => context.fillText(line, point.x - boxWidth / 2 + 10, point.y - (labelLines.length - 1) * 7 + index * 16, boxWidth - 20));
            if (node.detail) {
                context.fillStyle = "#7d8ea4";
                context.font = "10px Arial";
                context.fillText(wrapReportLine(node.detail, 28)[0].slice(0, 29), point.x - boxWidth / 2 + 10, point.y + 22, boxWidth - 20);
            }
        });
        context.fillStyle = "#344d6b";
        context.font = "700 14px Arial";
        context.fillText("Analysis and assumptions", 55, 720);
        context.fillStyle = "#6e8097";
        context.font = "12px Arial";
        diagram.details.slice(0, 3).forEach((detail, index) => {
            wrapReportLine(`• ${detail}`, 150).slice(0, 1).forEach((line) => context.fillText(line, 60, 748 + index * 21, 1080));
        });
        return canvas;
    }

    function getPdfReportPages() {
        const generated = new Date().toLocaleString();
        const schema = state.diagramSchema;
        const counts = {
            tables: schema.length,
            columns: schema.reduce((sum, table) => sum + table.columns.length, 0),
            keys: schema.reduce((sum, table) => sum + table.columns.filter((column) => column.pk).length, 0),
            relationships: schema.reduce((sum, table) => sum + table.foreign_keys.length, 0),
            indexes: schema.reduce((sum, table) => sum + table.indexes.length, 0)
        };
        const overview = [
            "## Report overview",
            `SQL dialect: ${state.diagramDialect.toUpperCase()}`,
            `Generated: ${generated}`,
            `Schema inventory: ${counts.tables} tables, ${counts.columns} columns, ${counts.keys} primary-key columns, ${counts.relationships} foreign keys, and ${counts.indexes} indexes.`,
            `Diagram set: ${state.diagramDefinitions.length} diagrams, including one directly derived ER model and ${state.diagramDefinitions.filter((diagram) => diagram.inferred).length} explicitly inferred behavior/architecture models.`,
            "",
            "## Interpretation and limitations",
            "The submitted SQL DDL is parsed locally in this browser. It is not executed, uploaded, or used to read database rows.",
            "ER entities, columns, and declared foreign-key edges are based on the parsed SQL schema.",
            "Use-case, object, package, state-transition, activity, and DFD elements are illustrative interpretations. Schema DDL does not establish actual actors, permissions, object instances, processes, deployment boundaries, or business-state rules.",
            "Object boxes show hypothetical typed attributes, not real records. Generic CRUD and lifecycle flows are examples, not discovered application behavior.",
            "",
            "## Diagram index",
            ...state.diagramDefinitions.map((diagram) => `${diagram.inferred ? "[INFERRED] " : "[FROM SQL] "}${diagram.title}: ${diagram.summary}`)
        ];
        const pages = [createReportTextCanvas("SQL Schema Analysis Report", `${state.diagramDialect.toUpperCase()} · ${generated}`, overview)];
        const schemaLines = ["## Parsed schema inventory"];
        schema.forEach((table) => {
            schemaLines.push(`## ${table.name}`);
            table.columns.forEach((column) => {
                const flags = [column.pk ? "PRIMARY KEY" : "", column.notnull ? "NOT NULL" : "", column.default !== null ? `DEFAULT ${column.default}` : ""].filter(Boolean).join(", ");
                schemaLines.push(`- ${column.name} · ${column.type || "unspecified type"}${flags ? ` · ${flags}` : ""}`);
            });
            table.indexes.forEach((index) => schemaLines.push(`- Index ${index.name} (${index.columns.join(", ")})${index.unique ? " · UNIQUE" : ""}`));
            table.foreign_keys.forEach((foreignKey) => schemaLines.push(`- Foreign key ${foreignKey.from} → ${foreignKey.to_table}.${foreignKey.to_column}`));
            schemaLines.push("");
        });
        const inventoryChunks = [];
        for (let index = 0; index < schemaLines.length; index += 29) inventoryChunks.push(schemaLines.slice(index, index + 29));
        inventoryChunks.forEach((lines, index) => pages.push(createReportTextCanvas("Schema Inventory", `Page ${index + 1} of ${inventoryChunks.length}`, lines)));
        state.diagramDefinitions.forEach((diagram) => pages.push(createDiagramReportCanvas(diagram)));

        const codeLines = state.diagramSql.replace(/\r\n/g, "\n").split("\n").flatMap((line) => {
            if (!line) return [""];
            const chunks = [];
            for (let index = 0; index < line.length; index += 145) chunks.push(line.slice(index, index + 145));
            return chunks;
        });
        const codeChunks = [];
        for (let index = 0; index < codeLines.length; index += 34) codeChunks.push(codeLines.slice(index, index + 34));
        codeChunks.forEach((lines, index) => pages.push(createReportTextCanvas(
            "Submitted SQL",
            `SQL source · page ${index + 1} of ${codeChunks.length}`,
            ["## Source code (read-only input)", ...lines]
        )));
        return pages;
    }

    async function canvasToJpeg(canvas) {
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => result ? resolve(result) : reject(new Error("The browser could not encode a PDF page.")), "image/jpeg", 0.83);
        });
        return new Uint8Array(await blob.arrayBuffer());
    }

    function concatenateBytes(chunks) {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        chunks.forEach((chunk) => {
            result.set(chunk, offset);
            offset += chunk.length;
        });
        return result;
    }

    async function createPdf(pages) {
        const encoder = new TextEncoder();
        const ascii = (value) => encoder.encode(value);
        const objects = new Map();
        const pageRefs = [];
        for (let index = 0; index < pages.length; index += 1) {
            const imageId = 3 + index * 3;
            const contentId = imageId + 1;
            const pageId = imageId + 2;
            pageRefs.push(`${pageId} 0 R`);
            const jpeg = await canvasToJpeg(pages[index]);
            const imageHeader = ascii(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pages[index].width} /Height ${pages[index].height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
            objects.set(imageId, concatenateBytes([imageHeader, jpeg, ascii("\nendstream\nendobj\n")]));
            const content = ascii(`q\n842 0 0 595 0 0 cm\n/Im0 Do\nQ\n`);
            objects.set(contentId, ascii(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n${new TextDecoder().decode(content)}endstream\nendobj\n`));
            objects.set(pageId, ascii(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`));
            $("#diagramProgress").textContent = `Preparing PDF page ${index + 1} of ${pages.length}…`;
            await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        objects.set(1, ascii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
        objects.set(2, ascii(`2 0 obj\n<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.join(" ")}] >>\nendobj\n`));
        const ids = Array.from(objects.keys()).sort((left, right) => left - right);
        const chunks = [ascii("%PDF-1.4\n")];
        let offset = chunks[0].length;
        const offsets = new Map();
        ids.forEach((id) => {
            offsets.set(id, offset);
            const bytes = objects.get(id);
            chunks.push(bytes);
            offset += bytes.length;
        });
        const xrefOffset = offset;
        const maxId = Math.max(...ids);
        let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
        for (let id = 1; id <= maxId; id += 1) {
            xref += `${offsets.has(id) ? String(offsets.get(id)).padStart(10, "0") : "0000000000"} ${offsets.has(id) ? "00000 n " : "00000 f "}\n`;
        }
        xref += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
        chunks.push(ascii(xref));
        return new Blob([concatenateBytes(chunks)], { type: "application/pdf" });
    }

    async function downloadDiagramPdf() {
        if (!state.diagramSchema.length || !state.diagramDefinitions.length) return;
        const button = $("#downloadDiagramPdf");
        button.disabled = true;
        try {
            $("#diagramProgress").textContent = "Preparing analysis and diagram pages…";
            const pages = getPdfReportPages();
            const pdf = await createPdf(pages);
            downloadBlob(pdf, "schemasphere-sql-diagram-analysis.pdf");
            $("#diagramProgress").textContent = `PDF downloaded with ${pages.length} pages, all diagrams, schema inventory, analysis notes, and submitted SQL.`;
            toast("Detailed diagram analysis PDF downloaded.");
        } catch (error) {
            $("#diagramProgress").textContent = `PDF could not be generated: ${error.message}`;
            toast(`PDF export failed: ${error.message}`, true);
        } finally {
            button.disabled = false;
        }
    }

    async function api(path, options = {}) {
        const response = await fetch(path, options);
        const contentType = response.headers.get("content-type") || "";
        const result = contentType.includes("application/json")
            ? await response.json()
            : await response.text();
        if (!response.ok) {
            const message = result && typeof result === "object" && result.error
                ? result.error
                : typeof result === "string" && result.trim() && !contentType.includes("text/html")
                    ? result.trim()
                    : `${response.status} ${response.statusText}`;
            throw new Error(message);
        }
        return result;
    }

    function toast(message, isError = false) {
        const item = document.createElement("div");
        item.className = `toast${isError ? " error" : ""}`;
        item.textContent = message;
        $("#toastRegion").append(item);
        window.setTimeout(() => item.remove(), 4200);
    }

    function setStatus(selector, text, healthy = true) {
        const element = $(selector);
        if (!element) return;
        element.textContent = text;
        element.classList.toggle("status-pill", true);
        element.style.color = healthy ? "" : "#b34850";
        element.style.background = healthy ? "" : "#ffebed";
    }

    function navigate(viewName) {
        const target = $(`#view-${viewName}`);
        if (!target) return;
        state.currentView = viewName;
        $$(".view").forEach((view) => view.classList.toggle("active", view === target));
        $$(".nav-item").forEach((item) => {
            const active = item.dataset.view === viewName;
            item.classList.toggle("active", active);
            if (active) item.setAttribute("aria-current", "page");
            else item.removeAttribute("aria-current");
        });
        if (viewName === "schema") {
            window.requestAnimationFrame(() => {
                if (state.explorerMode === "diagram") {
                    renderGraph();
                } else if (state.cy) {
                    state.cy.resize();
                }
            });
        }
        if (viewName === "docs" && !state.docLoaded) loadDocs();
    }

    function countSchema() {
        const tables = state.schema;
        return {
            tables: tables.length,
            columns: tables.reduce((sum, table) => sum + (table.columns || []).length, 0),
            relations: tables.reduce((sum, table) => sum + (table.foreign_keys || []).length, 0),
            keys: tables.reduce((sum, table) => sum + (table.columns || []).filter((column) => column.pk).length, 0)
        };
    }

    function updateMetrics() {
        const counts = countSchema();
        $("#tableCount").textContent = counts.tables;
        $("#columnCount").textContent = counts.columns;
        $("#relationshipCount").textContent = counts.relations;
        $("#primaryKeyCount").textContent = counts.keys;
        $("#statTables").textContent = counts.tables;
        $("#statColumns").textContent = counts.columns;
        $("#statKeys").textContent = counts.keys;
        $("#statRelationships").textContent = counts.relations;
        $("#lastUpdated").textContent = state.lastUpdated
            ? `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Just now";
    }

    function renderHealth() {
        if (!state.analysis) return;
        const score = Math.round(Math.max(0, Math.min(1, Number(state.analysis.quality_score) || 0)) * 100);
        const missingKeys = state.analysis.tables_without_pk || [];
        const missingIndexes = state.analysis.missing_fk_indexes || [];
        const namingIssues = state.analysis.naming_issues || [];
        const findings = missingKeys.length + missingIndexes.length + namingIssues.length;
        $("#healthScore").textContent = `${score}%`;
        $("#healthRing").style.setProperty("--score", `${score}%`);
        $("#statWarnings").textContent = missingKeys.length;
        const healthStatus = $("#healthStatus");
        healthStatus.textContent = findings ? `${findings} finding${findings === 1 ? "" : "s"}` : "Healthy";
        healthStatus.classList.toggle("attention", Boolean(findings));

        const checks = [
            {
                type: missingKeys.length ? "warning" : "good",
                title: missingKeys.length ? `${missingKeys.length} table${missingKeys.length === 1 ? "" : "s"} without a primary key` : "Primary key coverage",
                description: missingKeys.length ? "Tables may be harder to identify and reference." : "Every table has a primary key."
            },
            {
                type: missingIndexes.length ? "warning" : "good",
                title: missingIndexes.length ? `${missingIndexes.length} foreign key index suggestion${missingIndexes.length === 1 ? "" : "s"}` : "Relationship structure",
                description: missingIndexes.length ? "Review indexes for frequently joined columns." : "No foreign key index suggestions."
            },
            {
                type: namingIssues.length ? "issue" : "good",
                title: namingIssues.length ? `${namingIssues.length} naming convention issue${namingIssues.length === 1 ? "" : "s"}` : "Naming conventions",
                description: namingIssues.length ? "Some identifiers do not follow snake_case." : "Identifiers follow snake_case."
            }
        ];
        $("#healthChecklist").innerHTML = checks.map((item) => `
            <div class="health-item">
                <span class="health-item-icon ${item.type === "good" ? "" : item.type}">${icons[item.type === "good" ? "check" : item.type]}</span>
                <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></div>
            </div>`).join("");
        renderAnalysis();
    }

    function renderActivity() {
        const counts = countSchema();
        const activity = [
            {
                color: "green",
                icon: icons.check,
                title: "Schema loaded",
                description: `${counts.tables} tables · ${counts.relations} relationships`,
                time: state.lastUpdated ? state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now"
            },
            {
                color: "purple",
                icon: icons.warning,
                title: state.analysis ? "Quality analysis complete" : "Quality analysis unavailable",
                description: state.analysis ? "Structure and naming checks are up to date." : "Could not load analysis results.",
                time: "Now"
            },
            {
                color: "amber",
                icon: icons.database,
                title: "Local SQLite source",
                description: "Schema data served by this workspace.",
                time: "Active"
            }
        ];
        $("#activityList").innerHTML = activity.map((item) => `
            <div class="activity-row">
                <span class="activity-icon ${item.color}">${item.icon}</span>
                <div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></div>
                <span class="activity-time">${escapeHtml(item.time)}</span>
            </div>`).join("");
    }

    function renderAnalysis() {
        if (!state.analysis) return;
        const findings = [];
        (state.analysis.tables_without_pk || []).forEach((table) => findings.push({
            rule: "Missing primary key",
            severity: "high",
            table,
            subject: table,
            explanation: "This table has no declared primary key.",
            impact: "Rows cannot be identified reliably, which can complicate updates, joins, and references.",
            fix: "Choose a stable unique column or add a surrogate primary key."
        }));
        (state.analysis.missing_fk_indexes || []).forEach((item) => findings.push({
            rule: "Foreign key index coverage",
            severity: "low",
            table: item.table,
            subject: `${item.table}.${item.column}`,
            explanation: "No index begins with this foreign-key column.",
            impact: "Joins and parent-row checks may scan more rows as the table grows.",
            fix: `Review query patterns and consider an index on ${item.column}.`
        }));
        (state.analysis.naming_issues || []).forEach((identifier) => {
            const table = state.schema.find((item) => identifier === item.name || identifier.startsWith(`${item.name}.`));
            findings.push({
                rule: "Naming convention",
                severity: "medium",
                table: table ? table.name : null,
                subject: identifier,
                explanation: "This identifier does not follow the project's snake_case naming convention.",
                impact: "Mixed naming styles make schemas harder to scan and maintain consistently.",
                fix: "Rename the identifier to lowercase snake_case and update dependent queries."
            });
        });
        const counts = {
            all: findings.length,
            high: findings.filter((finding) => finding.severity === "high").length,
            medium: findings.filter((finding) => finding.severity === "medium").length,
            low: findings.filter((finding) => finding.severity === "low").length
        };
        $("#severitySummary").innerHTML = [
            ["all", "Total findings", counts.all],
            ["high", "High severity", counts.high],
            ["medium", "Medium severity", counts.medium],
            ["low", "Low severity", counts.low]
        ].map(([severity, label, count]) => `<div class="severity-card ${severity === "all" ? "" : severity}"><strong>${count}</strong><span>${label}</span></div>`).join("");

        const visible = state.analysisSeverity === "all"
            ? findings
            : findings.filter((finding) => finding.severity === state.analysisSeverity);
        const groups = new Map();
        visible.forEach((finding) => {
            const key = state.analysisGrouping === "table"
                ? finding.table || "Unassigned"
                : finding.rule;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(finding);
        });
        $("#analysisGrid").innerHTML = groups.size ? Array.from(groups.entries()).map(([title, items]) => `
            <section class="panel finding-group">
                <div class="finding-group-heading"><span>${escapeHtml(title)}</span><small>${items.length} finding${items.length === 1 ? "" : "s"}</small></div>
                ${items.map((finding) => `<article class="finding-card severity-${finding.severity}">
                    <div class="finding-top"><span class="finding-title">${escapeHtml(finding.rule)} · ${escapeHtml(finding.subject)}</span><span class="severity-badge ${finding.severity}">${finding.severity}</span></div>
                    <div class="finding-copy"><div><strong>Explanation</strong>${escapeHtml(finding.explanation)}</div><div><strong>Impact</strong>${escapeHtml(finding.impact)}</div><div><strong>Suggested fix</strong>${escapeHtml(finding.fix)}</div></div>
                    ${finding.table ? `<div class="finding-actions"><button class="text-button" data-finding-table="${escapeHtml(finding.table)}">Open ${escapeHtml(finding.table)} in schema <span aria-hidden="true">→</span></button></div>` : ""}
                </article>`).join("")}
            </section>`).join("") : `<div class="empty-state">${findings.length ? "No findings match this severity filter." : "No findings detected for the current rules."}</div>`;
        $$("[data-finding-table]", $("#analysisGrid")).forEach((button) => button.addEventListener("click", () => {
            const table = state.schema.find((item) => item.name === button.dataset.findingTable);
            if (table) {
                setExplorerMode("table");
                navigate("schema");
                selectTable(table);
                const treeItem = $$(".tree-item", $("#schemaTree")).find((item) => item.dataset.treeTable === table.name);
                if (treeItem) treeItem.open = true;
            }
        }));
    }

    function renderSchemaExplorer(filter = "") {
        const query = filter.trim().toLowerCase();
        const filtered = state.schema.filter((table) => !query
            || table.name.toLowerCase().includes(query)
            || (table.columns || []).some((column) => column.name.toLowerCase().includes(query)));
        $("#treeTableCount").textContent = `${filtered.length}/${state.schema.length}`;
        $("#explorerResultCount").textContent = `${filtered.length} tables`;
        if (!filtered.length) {
            $("#schemaTree").innerHTML = `<div class="docs-empty">${state.schema.length ? "No matching tables or columns." : "No tables found."}</div>`;
            $("#schemaRows").innerHTML = `<tr><td colspan="5">${state.schema.length ? "No matching tables or columns." : "No tables found."}</td></tr>`;
            return;
        }

        $("#schemaTree").innerHTML = filtered.map((table) => {
            const tableMatches = !query || table.name.toLowerCase().includes(query);
            const columns = (table.columns || []).filter((column) =>
                tableMatches || column.name.toLowerCase().includes(query)
            ).map((column) => `<div class="tree-column"><span class="${column.pk ? "tree-key" : ""}">${column.pk ? "◆ " : ""}${escapeHtml(column.name)}</span><span>${escapeHtml(column.type || "—")}</span></div>`).join("");
            const selected = state.selectedTable === table.name ? " selected" : "";
            return `<details class="tree-item${selected}" data-tree-table="${escapeHtml(table.name)}" ${query ? "open" : ""}>
                <summary data-select-table="${escapeHtml(table.name)}">${icons.table}<span>${escapeHtml(table.name)}</span><small>${(table.columns || []).length}</small></summary>
                <div class="tree-columns">${columns || '<div class="tree-column">No columns</div>'}</div>
            </details>`;
        }).join("");

        const rows = [];
        filtered.forEach((table) => {
            const tableMatches = !query || table.name.toLowerCase().includes(query);
            (table.columns || []).filter((column) =>
                tableMatches || column.name.toLowerCase().includes(query)
            ).forEach((column, index) => {
                const keys = [];
                if (column.pk) keys.push('<span class="tag pk">PRIMARY KEY</span>');
                if ((table.foreign_keys || []).some((foreignKey) => foreignKey.from === column.name)) keys.push('<span class="tag">FOREIGN KEY</span>');
                if (column.notnull) keys.push('<span class="tag">NOT NULL</span>');
                const indexes = (table.indexes || []).filter((item) => (item.columns || []).includes(column.name));
                const indexNames = indexes.map((item) => `${item.unique ? "UNIQUE " : ""}${item.name}`).join(", ");
                rows.push(`<tr data-row-table="${escapeHtml(table.name)}" class="${state.selectedTable === table.name ? "selected" : ""}">
                    <td>${index === 0 || !tableMatches ? `<strong>${escapeHtml(table.name)}</strong>` : ""}</td>
                    <td><code>${escapeHtml(column.name)}</code></td>
                    <td>${escapeHtml(column.type || "—")}</td>
                    <td>${keys.join(" ") || "—"}</td>
                    <td>${indexNames ? escapeHtml(indexNames) : "—"}</td>
                </tr>`);
            });
        });
        $("#schemaRows").innerHTML = rows.length
            ? rows.join("")
            : '<tr><td colspan="5">This table has no columns.</td></tr>';

        $$("[data-select-table]", $("#schemaTree")).forEach((summary) => summary.addEventListener("click", () => {
            const table = state.schema.find((item) => item.name === summary.dataset.selectTable);
            if (table) selectTable(table);
        }));
        $$("[data-row-table]", $("#schemaRows")).forEach((row) => row.addEventListener("click", () => {
            const table = state.schema.find((item) => item.name === row.dataset.rowTable);
            if (table) selectTable(table);
        }));
    }

    function selectTable(table) {
        state.selectedTable = table.name;
        showTableDetails(table);
        $$(".tree-item", $("#schemaTree")).forEach((item) => {
            const selected = item.dataset.treeTable === table.name;
            item.classList.toggle("selected", selected);
        });
        $$("#schemaRows tr").forEach((row) => row.classList.toggle("selected", row.dataset.rowTable === table.name));
        if (state.explorerMode === "diagram" && state.cy && state.cy.getElementById(table.name).length) {
            state.cy.nodes().unselect();
            const node = state.cy.getElementById(table.name);
            node.select();
            state.cy.animate({ center: { eles: node }, duration: 250 });
        }
    }

    function setExplorerMode(mode) {
        state.explorerMode = mode;
        $$(".mode-toggle button").forEach((button) => {
            const active = button.dataset.explorerMode === mode;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        $("#tableMode").classList.toggle("active", mode === "table");
        $("#diagramMode").classList.toggle("active", mode === "diagram");
        $("#explorerModeTitle").textContent = mode === "table" ? "Table view" : "Relationship map";
        if (mode === "diagram") {
            window.requestAnimationFrame(() => {
                renderGraph();
                if (state.selectedTable && state.cy && state.cy.getElementById(state.selectedTable).length) {
                    state.cy.getElementById(state.selectedTable).select();
                }
            });
        }
    }

    function showTableDetails(table) {
        state.selectedTable = table.name;
        const columns = (table.columns || []).map((column) => `<tr>
            <td><strong>${escapeHtml(column.name)}</strong></td>
            <td>${escapeHtml(column.type || "—")}</td>
            <td>${column.pk ? '<span class="tag pk">PK</span>' : ""}${column.notnull ? '<span class="tag">NOT NULL</span>' : ""}${column.default !== null && column.default !== undefined ? `<span class="tag">DEFAULT ${escapeHtml(column.default)}</span>` : ""}</td>
        </tr>`).join("");
        const indexes = (table.indexes || []).map((index) => `
            <div class="index-row"><strong>${escapeHtml(index.name)}</strong><br>${escapeHtml((index.columns || []).join(", ") || "Expression index")}
            · ${index.unique ? "Unique" : "Non-unique"}${index.partial ? " · Partial" : ""}</div>`).join("");
        const relations = (table.foreign_keys || []).map((fk) =>
            `<div class="relation-row">${escapeHtml(fk.from)} → <strong>${escapeHtml(fk.to_table)}.${escapeHtml(fk.to_column)}</strong></div>`
        ).join("");
        $("#tableDetails").innerHTML = `
            <div class="detail-title">${icons.table}<h2>${escapeHtml(table.name)}</h2></div>
            <span class="tag">${(table.columns || []).length} columns</span><span class="tag">${(table.indexes || []).length} indexes</span>
            <div class="detail-label">Data profile</div>
            <div id="tableProfile" class="index-row">Loading row count and null statistics…</div>
            <div class="detail-label">Columns</div>
            <div style="overflow:auto"><table class="schema-data-table"><thead><tr><th>NAME</th><th>TYPE</th><th>KEYS &amp; RULES</th></tr></thead><tbody>${columns || '<tr><td colspan="3">No column metadata available.</td></tr>'}</tbody></table></div>
            <div class="detail-label">Indexes</div>
            <div class="index-list">${indexes || '<div class="index-row">No indexes defined.</div>'}</div>
            <div class="detail-label">Relationships</div>
            <div class="relation-list">${relations || '<div class="relation-row">No outgoing foreign keys.</div>'}</div>`;
        loadTableProfile(table.name);
    }

    async function loadTableProfile(tableName) {
        const requestId = ++state.profileRequestId;
        const query = new URLSearchParams({ table: tableName });
        try {
            const profile = await api(`/api/profile?${query}`);
            if (requestId !== state.profileRequestId || state.selectedTable !== tableName) return;
            const rows = Object.entries(profile.null_stats || {}).map(([column, stats]) => `
                <div class="profile-row"><span>${escapeHtml(column)}</span><span>${stats.null_count} null · ${Number(stats.null_percent).toFixed(1)}%</span></div>`
            ).join("");
            $("#tableProfile").innerHTML = `<div class="profile-summary">${profile.row_count} row${profile.row_count === 1 ? "" : "s"}</div>${rows || '<span>No columns to profile.</span>'}`;
        } catch (error) {
            if (requestId !== state.profileRequestId || state.selectedTable !== tableName) return;
            $("#tableProfile").innerHTML = `<span class="profile-error">Profile unavailable: ${escapeHtml(error.message)}</span>`;
        }
    }

    function renderGraph() {
        const host = $("#cy");
        if (!window.cytoscape) {
            host.innerHTML = '<div class="empty-state" style="margin:20px">The relationship map library could not be loaded. The complete table list is available below.</div>';
            return;
        }
        if (state.cy) {
            state.cy.destroy();
            state.cy = null;
        }
        const nodes = state.schema.map((table) => ({
            data: {
                id: table.name,
                label: table.name,
                columnCount: (table.columns || []).length,
                keys: (table.columns || []).filter((column) => column.pk).map((column) => column.name).join(", ")
            }
        }));
        const edges = [];
        state.schema.forEach((table) => {
            (table.foreign_keys || []).forEach((fk, index) => {
                if (state.schema.some((target) => target.name === fk.to_table)) {
                    edges.push({
                        data: {
                            id: `edge-${edges.length}-${table.name}-${index}`,
                            source: table.name,
                            target: fk.to_table,
                            label: `${fk.from} → ${fk.to_column || "id"}`
                        }
                    });
                }
            });
        });
        state.cy = window.cytoscape({
            container: host,
            elements: [...nodes, ...edges],
            minZoom: 0.25,
            maxZoom: 2.5,
            boxSelectionEnabled: false,
            style: [
                {
                    selector: "node",
                    style: {
                        "background-color": "#f1f6ff",
                        "border-color": "#a8c4ff",
                        "border-width": 1.5,
                        "shape": "round-rectangle",
                        "width": 164,
                        "height": 58,
                        "padding": "12px",
                        "label": "data(label)",
                        "color": "#243d61",
                        "font-family": "DM Sans, sans-serif",
                        "font-size": 11,
                        "font-weight": 600,
                        "text-valign": "center",
                        "text-halign": "center",
                        "text-wrap": "ellipsis",
                        "text-max-width": 160
                    }
                },
                { selector: "node:selected", style: { "background-color": "#e4efff", "border-color": "#3477fa", "border-width": 2.5 } },
                {
                    selector: "edge",
                    style: {
                        "curve-style": "bezier",
                        "line-color": "#b8c7dc",
                        "target-arrow-color": "#8ea5c3",
                        "target-arrow-shape": "triangle",
                        "arrow-scale": 0.8,
                        "width": 1.4,
                        "line-style": "solid",
                        "label": "data(label)",
                        "font-size": 7,
                        "font-family": "DM Sans, sans-serif",
                        "color": "#8595aa",
                        "text-background-color": "#fff",
                        "text-background-opacity": 0.92,
                        "text-background-padding": "2px"
                    }
                },
                { selector: "edge:selected", style: { "line-color": "#4c82ef", "target-arrow-color": "#4c82ef", "width": 2 } }
            ],
            layout: {
                name: "cose",
                animate: true,
                animationDuration: 480,
                animationEasing: "ease-out",
                nodeRepulsion: 7200,
                idealEdgeLength: 130,
                edgeElasticity: 95,
                gravity: 0.3,
                padding: 35
            }
        });
        state.cy.on("tap", "node", (event) => {
            const table = state.schema.find((item) => item.name === event.target.id());
            if (table) selectTable(table);
        });
        state.cy.on("tap", (event) => {
            if (event.target === state.cy) {
                state.selectedTable = null;
                $("#tableDetails").innerHTML = '<div class="detail-placeholder"><span class="empty-icon">' + icons.table + '</span><strong>Explore a table</strong><span>Select any table in the map to inspect its columns and relationships.</span></div>';
            }
        });
        if (state.selectedTable && state.cy.getElementById(state.selectedTable).length) {
            state.cy.getElementById(state.selectedTable).select();
        }
    }

    function renderAll() {
        const imported = Boolean(state.activeSource && state.activeSource.imported);
        const sourceName = imported ? "Pasted SQL" : "Local SQLite";
        $("#databaseSourceName").textContent = sourceName;
        $("#activeSourceLabel").textContent = sourceName;
        $("#dashboardSqlSource").textContent = imported
            ? `${state.activeSource.tables} tables · ${state.activeSource.rows} rows`
            : "Using sample database";
        $("#view-connections .panel-description").textContent = imported
            ? "Every workspace API and section is reading the pasted SQL in its temporary isolated database."
            : "The workspace reads the configured DB_PATH database or the built-in sample database.";
        $("#view-settings .setting-row small").textContent = imported
            ? "Current workspace source: temporary isolated pasted SQL database."
            : "Current workspace source: DB_PATH or the built-in sample database.";
        updateMetrics();
        renderHealth();
        renderActivity();
        renderSchemaExplorer($("#schemaSearch").value);
        if (state.explorerMode === "diagram") renderGraph();
        state.docLoaded = false;
        setStatus("#connectionStatus", "Connected", true);
        setStatus("#dbStatus", "● Connected", true);
        setStatus("#connectionPageStatus", "Connected", true);
        setStatus("#schemaApiStatus", "Available", true);
    }

    async function refresh() {
        const button = $("#refreshBtn");
        if (button) button.disabled = true;
        try {
            const schema = await api("/api/schema");
            if (!Array.isArray(schema)) throw new Error("The schema endpoint returned an unexpected response.");
            state.schema = schema;
            state.activeSource = await api("/api/sql/source");
            state.lastUpdated = new Date();
            state.selectedTable = null;
            state.analysis = null;
            renderAll();
            try {
                state.analysis = await api("/api/analysis");
                renderHealth();
                renderActivity();
                renderAnalysis();
            } catch (error) {
                $("#healthChecklist").innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
                $("#analysisGrid").innerHTML = `<div class="error-state">Analysis unavailable: ${escapeHtml(error.message)}</div>`;
                setStatus("#healthStatus", "Analysis unavailable", false);
                renderActivity();
                toast(`Schema loaded, but analysis failed: ${error.message}`, true);
            }
            if (state.currentView === "docs") {
                state.docLoaded = false;
                await loadDocs();
            }
        } catch (error) {
            setStatus("#connectionStatus", "Unavailable", false);
            setStatus("#dbStatus", "● Connection error", false);
            setStatus("#connectionPageStatus", "Unavailable", false);
            setStatus("#schemaApiStatus", "Unavailable", false);
            $("#activityList").innerHTML = `<div class="error-state">Could not load the schema: ${escapeHtml(error.message)}</div>`;
            $("#schemaTree").innerHTML = `<div class="error-state">Could not load the schema: ${escapeHtml(error.message)}</div>`;
            $("#schemaRows").innerHTML = `<tr><td colspan="5">Could not load the schema: ${escapeHtml(error.message)}</td></tr>`;
            toast(`Could not load schema: ${error.message}`, true);
        } finally {
            if (button) button.disabled = false;
        }
    }

    function sampleDashboardSql() {
        return [
            "PRAGMA foreign_keys = ON;",
            "",
            "CREATE TABLE customers (",
            "    id INTEGER PRIMARY KEY,",
            "    name TEXT NOT NULL,",
            "    email TEXT NOT NULL UNIQUE",
            ");",
            "",
            "CREATE TABLE orders (",
            "    id INTEGER PRIMARY KEY,",
            "    customer_id INTEGER NOT NULL REFERENCES customers(id),",
            "    status TEXT NOT NULL DEFAULT 'pending',",
            "    total DECIMAL(10, 2) NOT NULL",
            ");",
            "",
            "CREATE TABLE order_items (",
            "    id INTEGER PRIMARY KEY,",
            "    order_id INTEGER NOT NULL REFERENCES orders(id),",
            "    sku TEXT NOT NULL,",
            "    quantity INTEGER NOT NULL DEFAULT 1",
            ");",
            "",
            "CREATE INDEX idx_orders_customer ON orders(customer_id);",
            "",
            "INSERT INTO customers (id, name, email) VALUES",
            "    (1, 'Avery Chen', 'avery@example.test'),",
            "    (2, 'Jordan Rivera', 'jordan@example.test');",
            "",
            "INSERT INTO orders (id, customer_id, status, total) VALUES",
            "    (101, 1, 'shipped', 229.49),",
            "    (102, 2, 'pending', 42.00);",
            "",
            "INSERT INTO order_items (id, order_id, sku, quantity) VALUES",
            "    (1, 101, 'KEYBOARD-01', 1),",
            "    (2, 101, 'DOCK-02', 1),",
            "    (3, 102, 'LAMP-03', 1);"
        ].join("\n");
    }

    function scheduleDashboardSqlImport() {
        const revision = ++state.sqlImportRevision;
        window.clearTimeout(state.dashboardSqlTimer);
        if (!$("#dashboardSqlInput").value.trim()) {
            $("#dashboardSqlStatus").textContent = "Paste a SQLite script to analyze it automatically.";
            $("#dashboardSqlStatus").classList.remove("error", "success");
            return;
        }
        $("#dashboardSqlStatus").textContent = "SQL changed. It will be analyzed when you pause typing…";
        $("#dashboardSqlStatus").classList.remove("error", "success");
        state.dashboardSqlTimer = window.setTimeout(() => importDashboardSql(revision), 850);
    }

    async function importDashboardSql(revision = ++state.sqlImportRevision) {
        window.clearTimeout(state.dashboardSqlTimer);
        const sql = $("#dashboardSqlInput").value;
        if (!sql.trim()) {
            $("#dashboardSqlStatus").textContent = "Paste a SQLite script before analyzing.";
            $("#dashboardSqlStatus").classList.add("error");
            return;
        }
        const button = $("#analyzeDashboardSql");
        button.disabled = true;
        $("#dashboardSqlStatus").textContent = "Importing into a temporary isolated database…";
        $("#dashboardSqlStatus").classList.remove("error", "success");
        try {
            const result = await api("/api/sql/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sql })
            });
            if (revision !== state.sqlImportRevision) return;
            state.activeSource = result;
            $("#diagramSqlInput").value = sql;
            $("#diagramSqlInput").dispatchEvent(new Event("input", { bubbles: true }));
            state.docLoaded = false;
            invalidateMigrationPreview();
            await refresh();
            if (revision !== state.sqlImportRevision) return;
            $("#baseSourceType").value = "demo_baseline";
            $("#targetSourceType").value = "current";
            $("#baseSourceType").dispatchEvent(new Event("change"));
            $("#targetSourceType").dispatchEvent(new Event("change"));
            compareSchemas();
            const summary = `${result.tables} tables · ${result.columns} columns · ${result.rows} rows`;
            $("#dashboardSqlStatus").textContent = `Workspace updated from pasted SQL: ${summary}. All sections now use this isolated database.`;
            $("#dashboardSqlStatus").classList.add("success");
            toast(`Workspace updated: ${summary}.`);
        } catch (error) {
            if (revision !== state.sqlImportRevision) return;
            $("#dashboardSqlStatus").textContent = `SQL was not applied; the previous workspace remains active. ${error.message}`;
            $("#dashboardSqlStatus").classList.add("error");
            toast(`SQL import failed: ${error.message}`, true);
        } finally {
            button.disabled = false;
        }
    }

    async function resetDashboardSql() {
        const revision = ++state.sqlImportRevision;
        window.clearTimeout(state.dashboardSqlTimer);
        const button = $("#resetDashboardSql");
        button.disabled = true;
        $("#dashboardSqlInput").value = "";
        $("#dashboardSqlStatus").textContent = "Restoring the configured workspace database…";
        $("#dashboardSqlStatus").classList.remove("error", "success");
        try {
            await api("/api/sql/reset", { method: "POST" });
            if (revision !== state.sqlImportRevision) return;
            $("#diagramSqlInput").value = "";
            generateDiagrams();
            state.docLoaded = false;
            invalidateMigrationPreview();
            await refresh();
            $("#dashboardSqlStatus").textContent = "Using the configured workspace database. Paste SQL any time to analyze an isolated copy.";
            $("#dashboardSqlStatus").classList.add("success");
        } catch (error) {
            $("#dashboardSqlStatus").textContent = `Could not restore the configured database: ${error.message}`;
            $("#dashboardSqlStatus").classList.add("error");
            toast(`Could not restore workspace database: ${error.message}`, true);
        } finally {
            button.disabled = false;
        }
    }

    async function loadDocs() {
        const preview = $("#docsPreview");
        if (!preview) return;
        preview.textContent = "Generating documentation…";
        try {
            state.markdown = await api("/api/doc");
            state.docsGeneratedAt = new Date();
            preview.textContent = state.markdown;
            $("#docsGenerated").textContent = `Generated ${state.docsGeneratedAt.toLocaleString()}`;
            state.docLoaded = true;
            renderDocs($("#docsSearch").value);
        } catch (error) {
            preview.textContent = `Documentation could not be generated: ${error.message}`;
            $("#docsContent").innerHTML = `<div class="error-state">Documentation could not be generated: ${escapeHtml(error.message)}</div>`;
            toast(`Documentation failed: ${error.message}`, true);
            return false;
        }
        return true;
    }

    function docsAnchor(tableName) {
        const index = state.schema.findIndex((table) => table.name === tableName);
        return `table-${index}-${tableName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    }

    function renderDocs(filter = "") {
        const query = filter.trim().toLowerCase();
        const matching = state.schema.filter((table) => !query
            || table.name.toLowerCase().includes(query)
            || (table.columns || []).some((column) =>
                `${column.name} ${column.type || ""} ${column.default || ""}`.toLowerCase().includes(query))
            || (table.indexes || []).some((index) =>
                `${index.name} ${(index.columns || []).join(" ")}`.toLowerCase().includes(query))
            || (table.foreign_keys || []).some((fk) =>
                `${fk.from} ${fk.to_table} ${fk.to_column}`.toLowerCase().includes(query)));
        if (!matching.length) {
            $("#docsToc").innerHTML = '<div class="docs-empty">No matching tables.</div>';
            $("#docsContent").innerHTML = `<div class="docs-empty">${state.schema.length ? "No documentation matches your search." : "No tables are available to document."}</div>`;
            return;
        }
        $("#docsToc").innerHTML = matching.map((table) =>
            `<a href="#${escapeHtml(docsAnchor(table.name))}">${escapeHtml(table.name)}</a>`
        ).join("");
        $("#docsContent").innerHTML = matching.map((table) => {
            const columns = (table.columns || []).map((column) => `<tr>
                <td><strong>${escapeHtml(column.name)}</strong></td>
                <td>${escapeHtml(column.type || "—")}</td>
                <td>${column.pk ? "Primary key" : "—"}${column.notnull ? " · Not null" : ""}</td>
                <td>${column.default === null || column.default === undefined ? "—" : escapeHtml(column.default)}</td>
            </tr>`).join("");
            const indexes = (table.indexes || []).map((index) =>
                `<tr><td>${escapeHtml(index.name)}</td><td>${escapeHtml((index.columns || []).join(", "))}</td><td>${index.unique ? "Unique" : "Non-unique"}${index.partial ? " · Partial" : ""}</td></tr>`
            ).join("");
            const relations = (table.foreign_keys || []).map((fk) =>
                `<tr><td>${escapeHtml(fk.from)}</td><td>${escapeHtml(fk.to_table)}.${escapeHtml(fk.to_column)}</td><td>Update: ${escapeHtml(fk.on_update || "NO ACTION")} · Delete: ${escapeHtml(fk.on_delete || "NO ACTION")}</td></tr>`
            ).join("");
            return `<section class="docs-table-section" id="${escapeHtml(docsAnchor(table.name))}">
                <h2>${escapeHtml(table.name)}</h2>
                <h3>Columns</h3><div style="overflow:auto"><table><thead><tr><th>Column</th><th>Data type</th><th>Keys &amp; constraints</th><th>Default</th></tr></thead><tbody>${columns || '<tr><td colspan="4">No columns.</td></tr>'}</tbody></table></div>
                <h3>Indexes</h3><div style="overflow:auto"><table><thead><tr><th>Index</th><th>Columns</th><th>Properties</th></tr></thead><tbody>${indexes || '<tr><td colspan="3">No indexes.</td></tr>'}</tbody></table></div>
                <h3>Relationships</h3><div style="overflow:auto"><table><thead><tr><th>Column</th><th>References</th><th>Actions</th></tr></thead><tbody>${relations || '<tr><td colspan="3">No foreign keys.</td></tr>'}</tbody></table></div>
            </section>`;
        }).join("");
    }

    async function downloadDocs(format = "markdown") {
        try {
            if ((!state.docLoaded || !state.markdown) && !(await loadDocs())) return;
            let content;
            let mimeType;
            let filename;
            if (format === "json") {
                content = JSON.stringify({
                    generated_at: state.docsGeneratedAt ? state.docsGeneratedAt.toISOString() : new Date().toISOString(),
                    tables: state.schema
                }, null, 2);
                mimeType = "application/json;charset=utf-8";
                filename = "database-documentation.json";
            } else if (format === "html") {
                const search = $("#docsSearch").value;
                renderDocs("");
                const documentation = $("#docsContent").innerHTML;
                renderDocs(search);
                const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Database Documentation</title><style>body{font:14px/1.6 system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#24364d}table{width:100%;border-collapse:collapse;margin:10px 0 24px}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5ebf4}th{background:#f4f7fc}section{break-inside:avoid}</style><body><h1>Database Documentation</h1><p>Generated ${escapeHtml(state.docsGeneratedAt ? state.docsGeneratedAt.toLocaleString() : new Date().toLocaleString())}</p>${documentation}</body></html>`;
                content = html;
                mimeType = "text/html;charset=utf-8";
                filename = "database-documentation.html";
            } else {
                content = state.markdown;
                mimeType = "text/markdown;charset=utf-8";
                filename = "database-documentation.md";
            }
            downloadBlob(new Blob([content], { type: mimeType }), filename);
            toast(`${format.toUpperCase()} documentation downloaded.`);
        } catch (error) {
            toast(`Could not generate documentation: ${error.message}`, true);
        }
    }

    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function svgEscape(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
        }[char]));
    }

    function buildDiagramSvg() {
        const gapX = 245;
        const gapY = 155;
        const cardWidth = 196;
        const cardHeight = 76;
        const columns = Math.max(1, Math.ceil(Math.sqrt(state.schema.length)));
        const positions = new Map(state.schema.map((table, index) => [
            table.name,
            { x: 45 + (index % columns) * gapX, y: 55 + Math.floor(index / columns) * gapY }
        ]));
        const width = Math.max(360, columns * gapX + 30);
        const rows = Math.max(1, Math.ceil(state.schema.length / columns));
        const height = Math.max(180, rows * gapY + 30);
        const links = [];
        state.schema.forEach((table) => (table.foreign_keys || []).forEach((fk) => {
            const from = positions.get(table.name);
            const to = positions.get(fk.to_table);
            if (from && to) {
                links.push(`<path d="M ${from.x + cardWidth / 2} ${from.y + cardHeight / 2} C ${(from.x + to.x) / 2 + cardWidth / 2} ${from.y + cardHeight / 2}, ${(from.x + to.x) / 2} ${to.y + cardHeight / 2}, ${to.x + cardWidth / 2} ${to.y + cardHeight / 2}" fill="none" stroke="#aabbd3" stroke-width="2" marker-end="url(#arrow)"/>`);
            }
        }));
        const cards = state.schema.map((table) => {
            const point = positions.get(table.name);
            const keyCount = (table.columns || []).filter((column) => column.pk).length;
            return `<g><rect x="${point.x}" y="${point.y}" width="${cardWidth}" height="${cardHeight}" rx="12" fill="#f1f6ff" stroke="#a8c4ff" stroke-width="2"/><text x="${point.x + 14}" y="${point.y + 29}" fill="#243d61" font-family="Arial,sans-serif" font-size="14" font-weight="700">${svgEscape(table.name)}</text><text x="${point.x + 14}" y="${point.y + 52}" fill="#72839b" font-family="Arial,sans-serif" font-size="11">${(table.columns || []).length} columns · ${keyCount} primary keys</text></g>`;
        }).join("");
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8ea5c3"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>${links.join("")}${cards}</svg>`;
    }

    function exportSvg() {
        if (!state.schema.length) {
            toast("There is no schema to export.", true);
            return;
        }
        const svg = buildDiagramSvg();
        downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "schema-relationship-map.svg");
        toast("Relationship map exported as SVG.");
    }

    async function exportPng() {
        if (!state.schema.length) {
            toast("There is no schema to export.", true);
            return;
        }
        try {
            const svg = buildDiagramSvg();
            const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
            const image = new Image();
            image.onload = () => {
                const scale = 2;
                const canvas = document.createElement("canvas");
                canvas.width = image.width * scale;
                canvas.height = image.height * scale;
                const context = canvas.getContext("2d");
                if (!context) {
                    URL.revokeObjectURL(svgUrl);
                    toast("Your browser could not prepare the PNG export.", true);
                    return;
                }
                context.scale(scale, scale);
                context.drawImage(image, 0, 0);
                URL.revokeObjectURL(svgUrl);
                canvas.toBlob((blob) => {
                    if (!blob) {
                        toast("Your browser could not create the PNG export.", true);
                        return;
                    }
                    downloadBlob(blob, "schema-relationship-map.png");
                    toast("Relationship map exported as PNG.");
                }, "image/png");
            };
            image.onerror = () => {
                URL.revokeObjectURL(svgUrl);
                toast("Could not render the relationship map as PNG.", true);
            };
            image.src = svgUrl;
        } catch (error) {
            toast(`PNG export failed: ${error.message}`, true);
        }
    }

    function renderMigrationResults(result) {
        const added = result.added_tables || [];
        const removed = result.removed_tables || [];
        const changed = result.column_changes || [];
        const addedDefinitions = result.added_table_definitions || [];
        const hasDestructiveChanges = removed.length > 0 || changed.some((item) =>
            (item.removed_columns || []).length > 0
            || (item.modified_columns || []).some((column) =>
                ["type", "notnull", "pk"].some((field) => (column.changed_fields || []).includes(field)))
        );
        const addedColumnsNeedingRebuild = changed.flatMap((item) =>
            (item.added_column_definitions || [])
                .filter((column) => column.pk || (column.notnull && (column.default === null || column.default === undefined)))
                .map((column) => `${item.table}.${column.name}`)
        );
        const sql = buildMigrationSql(result);
        state.migrationSql = sql;
        $("#migrationExport").disabled = false;
        $("#migrationValidate").disabled = false;
        const tableDiffs = [
            ...added.map((name) => `<div class="diff-item added"><strong>Added table</strong><br><code>${escapeHtml(name)}</code></div>`),
            ...removed.map((name) => `<div class="diff-item removed"><strong>Removed table · destructive</strong><br><code>${escapeHtml(name)}</code></div>`)
        ];
        const columnDiffs = changed.flatMap((change) => [
            ...(change.added_columns || []).map((name) => `<div class="diff-item added"><strong>Added column</strong><br><code>${escapeHtml(change.table)}.${escapeHtml(name)}</code></div>`),
            ...(change.removed_columns || []).map((name) => `<div class="diff-item removed"><strong>Removed column · destructive</strong><br><code>${escapeHtml(change.table)}.${escapeHtml(name)}</code></div>`),
            ...(change.modified_columns || []).map((column) => `<div class="diff-item modified"><strong>Modified column</strong><br><code>${escapeHtml(change.table)}.${escapeHtml(column.name)}</code><br>${(column.changed_fields || []).map(escapeHtml).join(", ")}</div>`)
        ]);
        const diffItems = [...tableDiffs, ...columnDiffs];
        $("#migrationOutput").innerHTML = `
            <div class="migration-status">Validation passed: both sources were readable and a schema diff was generated. This is a preview only; no SQL has been executed.</div>
            ${hasDestructiveChanges ? '<div class="migration-status warning"><strong>Destructive-change warning:</strong> this plan removes tables or columns, or changes a column definition. Review the generated SQL and back up the target before applying it manually.</div>' : ""}
            ${addedColumnsNeedingRebuild.length ? `<div class="migration-status warning"><strong>Manual migration required:</strong> SQLite cannot add a primary key this way, and a NOT NULL column without a default may not be added to a populated table. Review ${addedColumnsNeedingRebuild.map(escapeHtml).join(", ")}.</div>` : ""}
            <div class="diff-list">${diffItems.length ? diffItems.join("") : '<div class="empty-state">No schema changes detected.</div>'}</div>
            <div class="panel-heading" style="margin-top:16px"><div><h2 class="panel-title">Migration SQL preview</h2><p class="panel-description">Generated for review and export only. Table rebuilds may require manual steps.</p></div></div>
            <pre class="migration-code">${highlightSql(sql)}</pre>`;
    }

    function quoteSqlIdentifier(identifier) {
        return `"${String(identifier).replace(/"/g, '""')}"`;
    }

    function buildMigrationSql(result) {
        const lines = ["-- Schema migration preview. Review and validate before applying.", ""];
        (result.added_table_definitions || []).forEach((table) => {
            const columns = (table.columns || []).map((column) => {
                const parts = [quoteSqlIdentifier(column.name), column.type || ""].filter(Boolean);
                if (column.notnull) parts.push("NOT NULL");
                if (column.default !== null && column.default !== undefined) parts.push(`DEFAULT ${column.default}`);
                return `    ${parts.join(" ")}`;
            });
            const primaryKeys = (table.columns || []).filter((column) => column.pk).map((column) => quoteSqlIdentifier(column.name));
            if (primaryKeys.length) columns.push(`    PRIMARY KEY (${primaryKeys.join(", ")})`);
            (table.foreign_keys || []).forEach((foreignKey) => {
                const actions = [
                    foreignKey.on_update && foreignKey.on_update !== "NO ACTION" ? `ON UPDATE ${foreignKey.on_update}` : "",
                    foreignKey.on_delete && foreignKey.on_delete !== "NO ACTION" ? `ON DELETE ${foreignKey.on_delete}` : ""
                ].filter(Boolean).join(" ");
                columns.push(`    FOREIGN KEY (${quoteSqlIdentifier(foreignKey.from)}) REFERENCES ${quoteSqlIdentifier(foreignKey.to_table)} (${quoteSqlIdentifier(foreignKey.to_column)})${actions ? ` ${actions}` : ""}`);
            });
            lines.push(`CREATE TABLE ${quoteSqlIdentifier(table.name)} (`, `${columns.join(",\n")}`, ");", "");
        });
        (result.column_changes || []).forEach((change) => {
            (change.added_column_definitions || []).forEach((column) => {
                if (column.pk || (column.notnull && (column.default === null || column.default === undefined))) {
                    lines.push(`-- Manual table rebuild required to add ${change.table}.${column.name} with the requested constraints.`);
                    return;
                }
                const parts = [quoteSqlIdentifier(column.name), column.type || ""].filter(Boolean);
                if (column.notnull) parts.push("NOT NULL");
                if (column.default !== null && column.default !== undefined) parts.push(`DEFAULT ${column.default}`);
                lines.push(`ALTER TABLE ${quoteSqlIdentifier(change.table)} ADD COLUMN ${parts.join(" ")};`);
            });
            (change.removed_columns || []).forEach((column) => {
                lines.push(`-- Destructive: removes the ${column} column and its data.`);
                lines.push(`ALTER TABLE ${quoteSqlIdentifier(change.table)} DROP COLUMN ${quoteSqlIdentifier(column)};`);
            });
            (change.modified_columns || []).forEach((column) => {
                lines.push(`-- Manual table rebuild required to modify ${change.table}.${column.name} (${(column.changed_fields || []).join(", ")}).`);
            });
            if ((change.added_columns || []).length || (change.removed_columns || []).length || (change.modified_columns || []).length) lines.push("");
        });
        (result.removed_tables || []).forEach((table) => {
            lines.push(`-- Destructive: drops ${table} and all of its data.`);
            lines.push(`DROP TABLE ${quoteSqlIdentifier(table)};`, "");
        });
        return lines.join("\n").trimEnd() + "\n";
    }

    function highlightSql(sql) {
        return sql.split("\n").map((line) => {
            const escaped = escapeHtml(line);
            if (/^\s*--/.test(line)) return `<span class="sql-comment">${escaped}</span>`;
            return escaped
                .replace(/\b(CREATE|TABLE|PRIMARY|KEY|NOT|NULL|DEFAULT|ALTER|ADD|COLUMN|DROP)\b/gi, '<span class="sql-keyword">$1</span>')
                .replace(/'[^']*'/g, '<span class="sql-string">$&</span>');
        }).join("\n");
    }

    function migrationSourceKey() {
        return JSON.stringify([
            $("#baseSourceType").value,
            $("#migrationBase").value.trim(),
            $("#targetSourceType").value,
            $("#migrationTarget").value.trim()
        ]);
    }

    function invalidateMigrationPreview() {
        state.migrationRequestId += 1;
        state.migrationSql = "";
        $("#migrationExport").disabled = true;
        $("#migrationValidate").disabled = true;
        $("#migrationOutput").innerHTML = '<div class="empty-state">Sources changed. Preview and validate the comparison again.</div>';
    }

    async function compareSchemas(event) {
        if (event) event.preventDefault();
        const requestId = ++state.migrationRequestId;
        const sourceKey = migrationSourceKey();
        const baseSource = $("#baseSourceType").value;
        const targetSource = $("#targetSourceType").value;
        const base = baseSource === "current"
            ? "__current__"
            : baseSource === "demo_baseline"
                ? "__demo_baseline__"
                : $("#migrationBase").value.trim();
        const target = targetSource === "current"
            ? "__current__"
            : targetSource === "demo_target"
                ? "__demo_target__"
                : $("#migrationTarget").value.trim();
        const output = $("#migrationOutput");
        state.migrationSql = "";
        $("#migrationExport").disabled = true;
        $("#migrationValidate").disabled = true;
        output.innerHTML = '<div class="empty-state"><span class="loading"><span class="spinner"></span>Comparing schemas…</span></div>';
        try {
            const query = new URLSearchParams({ base, target });
            const result = await api(`/api/migrate/diff?${query}`);
            if (requestId !== state.migrationRequestId || sourceKey !== migrationSourceKey()) return;
            renderMigrationResults(result);
        } catch (error) {
            if (requestId !== state.migrationRequestId || sourceKey !== migrationSourceKey()) return;
            output.innerHTML = `<div class="error-state">Schema comparison failed: ${escapeHtml(error.message)}</div>`;
            toast(`Schema comparison failed: ${error.message}`, true);
        }
    }

    function handleSearch(value) {
        const query = value.trim();
        if (query) {
            navigate("schema");
            $("#schemaSearch").value = query;
            renderSchemaExplorer(query);
        } else {
            $("#schemaSearch").value = "";
            renderSchemaExplorer("");
        }
    }

    function initialize() {
        $$(".nav-item").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.view)));
        $$("[data-navigate]").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.navigate)));
        $$('[data-action="refresh"]').forEach((item) => item.addEventListener("click", refresh));
        $$('[data-action="docs"]').forEach((item) => item.addEventListener("click", downloadDocs));
        $("#refreshBtn").addEventListener("click", refresh);
        $("#topRefresh").addEventListener("click", refresh);
        $("#dashboardSqlInput").addEventListener("input", scheduleDashboardSqlImport);
        $("#analyzeDashboardSql").addEventListener("click", () => importDashboardSql());
        $("#resetDashboardSql").addEventListener("click", resetDashboardSql);
        $("#loadDashboardSqlSample").addEventListener("click", () => {
            $("#dashboardSqlInput").value = sampleDashboardSql();
            $("#dashboardSqlInput").dispatchEvent(new Event("input", { bubbles: true }));
        });
        $("#downloadMD").addEventListener("click", downloadDocs);
        $("#exportSVG").addEventListener("click", exportSvg);
        $("#exportPNG").addEventListener("click", exportPng);
        $("#schemaSearch").addEventListener("input", (event) => renderSchemaExplorer(event.target.value));
        $("#globalSearch").addEventListener("input", (event) => handleSearch(event.target.value));
        $("#migrationForm").addEventListener("submit", compareSchemas);
        $("#migrationValidate").addEventListener("click", compareSchemas);
        $("#migrationExport").addEventListener("click", () => {
            if (state.migrationSql) {
                downloadBlob(new Blob([state.migrationSql], { type: "text/sql;charset=utf-8" }), "schema-migration-preview.sql");
                toast("SQL preview exported. It has not been executed.");
            }
        });
        $("#baseSourceType").addEventListener("change", (event) => {
            const pathInput = $("#migrationBase");
            const usesPath = event.target.value === "path";
            pathInput.hidden = !usesPath;
            pathInput.required = usesPath;
            invalidateMigrationPreview();
        });
        $("#targetSourceType").addEventListener("change", (event) => {
            const pathInput = $("#migrationTarget");
            const usesPath = event.target.value === "path";
            pathInput.hidden = !usesPath;
            pathInput.required = usesPath;
            invalidateMigrationPreview();
        });
        $("#migrationBase").addEventListener("input", invalidateMigrationPreview);
        $("#migrationTarget").addEventListener("input", invalidateMigrationPreview);
        $("#loadDemoMigration").addEventListener("click", () => {
            $("#baseSourceType").value = "demo_baseline";
            $("#targetSourceType").value = "demo_target";
            $("#baseSourceType").dispatchEvent(new Event("change"));
            $("#targetSourceType").dispatchEvent(new Event("change"));
            compareSchemas();
        });
        $("#docsSearch").addEventListener("input", (event) => renderDocs(event.target.value));
        $$("[data-doc-export]").forEach((button) => button.addEventListener("click", () => downloadDocs(button.dataset.docExport)));
        $$(".mode-toggle button").forEach((button) => button.addEventListener("click", () => setExplorerMode(button.dataset.explorerMode)));
        $$(".severity-filter").forEach((button) => button.addEventListener("click", () => {
            state.analysisSeverity = button.dataset.severity;
            $$(".severity-filter").forEach((filter) => filter.classList.toggle("active", filter === button));
            renderAnalysis();
        }));
        $("#analysisGrouping").addEventListener("change", (event) => {
            state.analysisGrouping = event.target.value;
            renderAnalysis();
        });
        $("#loadDiagramSample").addEventListener("click", () => {
            $("#diagramSqlInput").value = [
                "CREATE TABLE customers (",
                "    id INTEGER PRIMARY KEY,",
                "    name TEXT NOT NULL,",
                "    email TEXT NOT NULL UNIQUE",
                ");",
                "",
                "CREATE TABLE orders (",
                "    id INTEGER PRIMARY KEY,",
                "    customer_id INTEGER NOT NULL REFERENCES customers(id),",
                "    status TEXT NOT NULL DEFAULT 'pending',",
                "    total DECIMAL(10, 2) NOT NULL",
                ");",
                "",
                "CREATE TABLE order_items (",
                "    id INTEGER PRIMARY KEY,",
                "    order_id INTEGER NOT NULL REFERENCES orders(id),",
                "    sku TEXT NOT NULL,",
                "    quantity INTEGER NOT NULL DEFAULT 1",
                ");",
                "",
                "CREATE INDEX idx_orders_customer ON orders(customer_id);"
            ].join("\n");
            $("#diagramSqlInput").dispatchEvent(new Event("input", { bubbles: true }));
        });
        $("#generateDiagrams").addEventListener("click", generateDiagrams);
        $("#diagramSqlInput").addEventListener("input", () => {
            $("#diagramParseStatus").textContent = "Analyzing…";
            window.clearTimeout(state.diagramTimer);
            state.diagramTimer = window.setTimeout(generateDiagrams, 350);
        });
        $("#diagramDialect").addEventListener("change", () => {
            if ($("#diagramSqlInput").value.trim()) generateDiagrams();
        });
        $("#clearDiagramSql").addEventListener("click", () => {
            $("#diagramSqlInput").value = "";
            generateDiagrams();
            $("#diagramSqlInput").focus();
        });
        $("#downloadDiagramPdf").addEventListener("click", downloadDiagramPdf);
        $("#zoomIn").addEventListener("click", () => {
            if (state.cy) state.cy.zoom({ level: state.cy.zoom() * 1.2, renderedPosition: { x: state.cy.width() / 2, y: state.cy.height() / 2 } });
        });
        $("#zoomOut").addEventListener("click", () => {
            if (state.cy) state.cy.zoom({ level: state.cy.zoom() / 1.2, renderedPosition: { x: state.cy.width() / 2, y: state.cy.height() / 2 } });
        });
        $("#fitGraph").addEventListener("click", () => {
            if (state.cy) state.cy.fit(undefined, 40);
        });
        window.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                $("#globalSearch").focus();
            }
            if (event.key === "Escape" && document.activeElement === $("#globalSearch")) {
                $("#globalSearch").value = "";
                handleSearch("");
                $("#globalSearch").blur();
            }
        });
        refresh();
    }

    initialize();
})();
