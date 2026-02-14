#!/usr/bin/env npx tsx
import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
)

async function check() {
  // Get a version to check
  const { data: version } = await supabase
    .from("merit_badge_versions")
    .select("id, badge_name, version_year")
    .eq("badge_name", "Camping")
    .eq("version_year", 2024)
    .single()

  if (!version) {
    console.log("No Camping 2024 version found")
    return
  }

  console.log("Checking", version.badge_name, version.version_year)

  // Get requirements for this version
  const { data: reqs } = await supabase
    .from("merit_badge_requirements")
    .select("id, scoutbook_id, display_label, description, parent_id, depth, is_header, sort_order")
    .eq("badge_version_id", version.id)
    .order("sort_order")

  console.log("\nRequirements with hierarchy:")
  const reqById = new Map(reqs?.map(r => [r.id, r]) || [])

  for (const req of reqs || []) {
    const indent = "  ".repeat(req.depth)
    const parent = req.parent_id ? reqById.get(req.parent_id) : null
    const parentInfo = parent ? " (parent: " + parent.scoutbook_id + ")" : ""
    const headerFlag = req.is_header ? " [HEADER]" : ""
    const desc = req.description ? req.description.substring(0, 40) : "NO DESC"
    console.log(indent + req.scoutbook_id + headerFlag + parentInfo + " - " + desc)
  }

  // Count headers vs non-headers
  const headers = reqs?.filter(r => r.is_header) || []
  const withParent = reqs?.filter(r => r.parent_id) || []
  console.log("\nStats:")
  console.log("  Total requirements:", reqs?.length)
  console.log("  Headers (is_header=true):", headers.length)
  console.log("  With parent_id:", withParent.length)
}

check()
