import { redirect } from "next/navigation";

/** My trips lives in the library on the globe now; old links open it there. */
export default function TripsPage() {
  redirect("/?trips");
}
