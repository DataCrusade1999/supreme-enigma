import { NextResponse } from "next/server";
import { parseBody, withStore } from "@/lib/vpn/api";
import { settingsSchema, updateSettings } from "@/lib/vpn/model";
import { mutateDesired } from "@/lib/vpn/store";

export function PUT(request: Request) {
  return withStore(async (store) => {
    const settings = await parseBody(request, settingsSchema);
    const desired = await mutateDesired(store, (d) => updateSettings(d, settings));
    return NextResponse.json({ desired });
  });
}
