import {
  createError,
  defineEventHandler,
  getRouterParam,
  readMultipartFormData,
  setResponseStatus
} from "h3";
import { saveIntakeImage } from "../../../../services/intake.service";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const intakeId = getRouterParam(event, "intakeId") || "";
  const parts = await readMultipartFormData(event);
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: "请上传图片" });
  }
  const rolePart = parts.find((part) => part.name === "imageRole");
  const imagePart = parts.find((part) => part.name === "image" && part.filename);
  const thumbnailPart = parts.find((part) => part.name === "thumbnail" && part.filename);
  if (!rolePart || !imagePart) {
    throw createError({ statusCode: 400, statusMessage: "图片和图片类型不能为空" });
  }

  const result = await saveIntakeImage({
    user: getRequestUser(event),
    intakeId,
    imageRole: Buffer.from(rolePart.data).toString("utf8").trim(),
    mimeType: imagePart.type || "",
    data: Buffer.from(imagePart.data),
    thumbnail: thumbnailPart
      ? {
          mimeType: thumbnailPart.type || "",
          data: Buffer.from(thumbnailPart.data)
        }
      : undefined
  });
  setResponseStatus(event, 202);
  return ok(result);
});
