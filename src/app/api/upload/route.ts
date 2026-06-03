import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export async function POST(request: Request) {
  try {
    const s3Client = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    const { filename, contentType } = await request.json();
    if (!filename || !contentType) {
      return NextResponse.json({ error: "Filename and content type required" }, { status: 400 });
    }

    const uniqueFilename = `${Date.now()}-${filename.replace(/\s+/g, '-')}`;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: `raw-uploads/${uniqueFilename}`,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });
    
    return NextResponse.json({ uploadUrl: signedUrl, fileKey: uniqueFilename });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}