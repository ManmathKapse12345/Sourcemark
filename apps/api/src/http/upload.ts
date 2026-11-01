import multer from "multer";
import { badRequest } from "./errors.js";

type Rule = { mimes: string[]; magic?: number[]; magicAt?: number; image?: boolean };

const DOCUMENTS: Record<string, Rule> = {
  ".pdf": { mimes: ["application/pdf"], magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ".docx": {
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"],
    magic: [0x50, 0x4b, 0x03, 0x04], // zip
  },
  ".txt": { mimes: ["text/plain"] },
  ".md": { mimes: ["text/markdown", "text/plain", "application/octet-stream"] },
};

const IMAGES: Record<string, Rule> = {
  ".png": { mimes: ["image/png"], magic: [0x89, 0x50, 0x4e, 0x47], image: true },
  ".jpg": { mimes: ["image/jpeg"], magic: [0xff, 0xd8, 0xff], image: true },
  ".jpeg": { mimes: ["image/jpeg"], magic: [0xff, 0xd8, 0xff], image: true },
  ".webp": { mimes: ["image/webp"], magic: [0x57, 0x45, 0x42, 0x50], magicAt: 8, image: true }, // "WEBP" after the RIFF header
};

const extension = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

// What each upload accepts: guidelines are documents, content may also be an image, logos are images only.
export type Accept = "documents" | "documents-or-images" | "images";
const RULES: Record<Accept, Record<string, Rule>> = {
  documents: DOCUMENTS,
  "documents-or-images": { ...DOCUMENTS, ...IMAGES },
  images: IMAGES,
};
const MESSAGES: Record<Accept, string> = {
  documents: "Upload a PDF, DOCX, TXT or MD file",
  "documents-or-images": "Upload a PDF, DOCX, TXT or MD file, or a PNG, JPEG or WebP image",
  images: "Upload a PNG, JPEG or WebP image",
};

export function uploader(maxMb: number, accept: Accept = "documents") {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const rule = RULES[accept][extension(file.originalname)];
      if (!rule || !rule.mimes.includes(file.mimetype)) {
        cb(badRequest(MESSAGES[accept]));
        return;
      }
      cb(null, true);
    },
  });
}

export const isImage = (file: Express.Multer.File) => !!IMAGES[extension(file.originalname)];

// The declared type is not trusted: check the file's leading bytes as well.
export function assertFileContent(file: Express.Multer.File) {
  const rule = DOCUMENTS[extension(file.originalname)] ?? IMAGES[extension(file.originalname)];
  const at = rule?.magicAt ?? 0;
  if (rule?.magic && !rule.magic.every((b, i) => file.buffer[at + i] === b)) {
    throw badRequest("The file's contents do not match its type");
  }
  if (!rule?.magic && file.buffer.includes(0)) {
    throw badRequest("Text files must not contain binary data");
  }
}
