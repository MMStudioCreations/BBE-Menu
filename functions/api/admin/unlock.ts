import { json } from "../_auth";

const gone = () => json({ ok: false, error: "deprecated" }, 410);

export const onRequestGet: PagesFunction = async () => gone();
export const onRequestPost: PagesFunction = async () => gone();
