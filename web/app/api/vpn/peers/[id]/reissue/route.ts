import { NextResponse } from "next/server";
import { parseBody, withStore } from "@/lib/vpn/api";
import { isPublicKey, reissuePeer, VpnError } from "@/lib/vpn/model";
import { mutateDesired } from "@/lib/vpn/store";
import { z } from "@/lib/zod";

const reissueSchema = z.object({ publicKey: z.string().refine(isPublicKey) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withStore(async (store) => {
    const { publicKey } = await parseBody(request, reissueSchema);
    const desired = await mutateDesired(store, (d) => reissuePeer(d, id, publicKey));
    const peer = desired.peers.find((p) => p.id === id);
    if (!peer) throw new VpnError("conflict");
    return NextResponse.json({ desired, peer });
  });
}
