import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.join(__dirname, "..");
const srcDir = path.join(backendRoot, "src");

// Helper to recursively find all .ts files
function getTsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getTsFiles(filePath));
    } else if (file.endsWith(".ts") && !file.endsWith(".d.ts")) {
      results.push(filePath);
    }
  });
  return results;
}

// Convert a single file's imports
function convertFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const fileRelativeDir = path.dirname(filePath);
  
  // Pattern to match import/export statements
  // e.g., import { foo } from "./bar"; or export { default } from "@/baz";
  const importExportRegex = /(import|export)\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

  let modified = false;
  const newContent = content.replace(importExportRegex, (match, type, items, importPath) => {
    let resolvedPath = importPath;
    let isLocal = false;

    // 1. Resolve alias path @/
    if (importPath.startsWith("@/")) {
      isLocal = true;
      const absoluteTarget = path.join(srcDir, importPath.substring(2));
      const relativeToCurrent = path.relative(fileRelativeDir, absoluteTarget);
      resolvedPath = relativeToCurrent.startsWith(".") ? relativeToCurrent : "./" + relativeToCurrent;
    } else if (importPath.startsWith(".") || importPath.startsWith("..")) {
      isLocal = true;
    }

    if (isLocal) {
      // Normalize path windows-slashes to unix-slashes
      resolvedPath = resolvedPath.replace(/\\/g, "/");

      // Check if it already has .js extension
      if (!resolvedPath.endsWith(".js")) {
        // Resolve the actual file on disk to see if it's a file or directory
        const absoluteImportPath = path.resolve(fileRelativeDir, resolvedPath);
        
        let pathWithExtension = resolvedPath;
        if (fs.existsSync(absoluteImportPath) && fs.statSync(absoluteImportPath).isDirectory()) {
          // If it's a directory, check for index.ts
          if (fs.existsSync(path.join(absoluteImportPath, "index.ts"))) {
            pathWithExtension = resolvedPath.endsWith("/") ? resolvedPath + "index.js" : resolvedPath + "/index.js";
          }
        } else {
          // Otherwise, it's a file, append .js
          pathWithExtension = resolvedPath + ".js";
        }
        
        modified = true;
        return `${type} ${items} from "${pathWithExtension}"`;
      }
    }

    return match;
  });

  if (modified) {
    fs.writeFileSync(filePath, newContent, "utf8");
    console.log(`✓ Converted imports in: ${path.relative(backendRoot, filePath)}`);
  }
}

function run() {
  const tsFiles = getTsFiles(srcDir);
  console.log(`Found ${tsFiles.length} files to check.`);
  tsFiles.forEach(convertFile);
  console.log("Import conversion complete!");
}

run();
