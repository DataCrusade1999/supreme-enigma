import path from "node:path";
import { createReader } from "@keystatic/core/reader";
import config from "../keystatic.config";

export function getReader() {
  return createReader(path.join(process.cwd(), ".."), config);
}
