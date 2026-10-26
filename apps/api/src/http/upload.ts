import multer from "multer";
import { badRequest } from "./errors.js";

const ALLOWED: Record<string, { mimes: string[]; magic?: number[] }> = {
  ".pdf": { mimes: ["application/pdf"], magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ".docx": {
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"],
    magic: [0x50, 0x4b, 0x03, 0x04], // zip
  },
  ".txt": { mimes: ["text/plain"] },
  ".md": { mimes: ["text/markdown", "text/plain", "application/octet-stream"] },
};

const extension = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

export function uploader(maxMb: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const rule = ALLOWED[extension(file.originalname)];
      if (!rule || !rule.mimes.includes(file.mimetype)) {
        cb(badRequest("Upload a PDF, DOCX, TXT or MD file"));
        return;
      }
      cb(null, true);
    },
  });
}

// The declared type is not trusted: check the file's leading bytes as well.
export function assertFileContent(file: Express.Multer.File) {
  const rule = ALLOWED[extension(file.originalname)];
  if (rule?.magic && !rule.magic.every((b, i) => file.buffer[i] === b)) {
    throw badRequest("The file's contents do not match its type");
  }
  if (!rule?.magic && file.buffer.includes(0)) {
    throw badRequest("Text files must not contain binary data");
  }
}
