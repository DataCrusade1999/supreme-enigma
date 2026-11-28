import { NextResponse } from "next/server";
import { withStore } from "@/lib/vpn/api";
import { removePeer } from "@/lib/vpn/model";
import { mutateDesired } from "@/lib/vpn/store";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withStore(async (store) => {
    const desired = await mutateDesired(store, (d) => removePeer(d, id));
    return NextResponse.json({ desired });
  });
}
