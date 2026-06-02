# Email Drafts

Reviewable outbound email draft records live here.

Current flow:

1. Create draft markdown with `type: email-draft` and `status: draft`.
2. Approve it in the Email tab, changing status to `approved`.
3. Send only through the explicit send-confirmation flow.
4. Orbiter marks the draft `sent` and writes an audit record to `journal/email-sent/`.

This folder can contain private message content and must stay ignored by Git except for this README.
