import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { startLanguageServer } from "./server.js";

startLanguageServer(createConnection(ProposedFeatures.all));
