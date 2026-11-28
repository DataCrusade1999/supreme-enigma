import { NextResponse } from "next/server";
import { parseBody, withStore } from "@/lib/vpn/api";
import { addPeer, peerInputSchema, VpnError } from "@/lib/vpn/model";
import { mutateDesired } from "@/lib/vpn/store";

export function POST(request: Request) {
  return withStore(async (store) => {
    const { name, publicKey } = await parseBody(request, peerInputSchema);
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const desired = await mutateDesired(store, (d) => addPeer(d, { id, name, publicKey, now }));
    const peer = desired.peers.find((p) => p.id === id);
    if (!peer) throw new VpnError("conflict");
    return NextResponse.json({ desired, peer }, { status: 201 });
  });
}
