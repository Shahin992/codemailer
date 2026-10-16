import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/unsubscribe";

type Ctx = { params: Promise<{ token: string }> };

// One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe header.
export async function POST(_request: Request, { params }: Ctx) {
  const { token } = await params;
  const email = await unsubscribeByToken(token);
  return email ? new NextResponse("Unsubscribed", { status: 200 }) : new NextResponse("Invalid link", { status: 404 });
}

// A person opening the header link in a browser gets the confirmation page instead.
export async function GET(request: Request, { params }: Ctx) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/u/${token}`, request.url));
}
