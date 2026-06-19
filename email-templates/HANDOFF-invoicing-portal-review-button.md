# Handoff brief: add an optional "Leave us a Google review" button to outbound emails

**Paste this entire file into Claude Code in the invoicing/estimates portal repo.**

---

## What we want

National Sports sends customer emails from the invoicing/estimates portal (estimates,
art proofs, invoices, etc.). We want the option to include a **"Leave us a Google review"**
button in those emails. Google reviews are a major lever for both local search and how AI
assistants answer "best team dealer in California"-type questions, so this is worth doing well.

Two hard requirements:

1. **It's optional per send** — the person sending decides whether the button is included. It is
   **off by default** unless we decide otherwise (see questions below).
2. **It must not break email rendering** — especially Outlook, which is where buttons usually fall apart.

---

## ⚠️ Before you build: investigate, then ask ME questions

Do **not** start coding from assumptions. You know this repo's email pipeline and I don't, so:

1. **Investigate the repo first.** Find how emails are composed and sent today — the send code,
   the templating/layout, where estimate/proof/invoice emails are generated, and whether there's a
   shared email layout/footer.
2. **Then come back and ask me these questions** (fill in what you can from the code first, and ask me
   to confirm or decide the rest):
   - **Which emails get the button?** Estimates, art proofs, invoices — all of them, or only some?
   - **How is "optional" controlled?** A checkbox on the send screen? A per-customer setting?
     Default-on for certain types? What should the default be?
   - **Placement:** in the email footer, or as its own block after the body content?
   - **Shared layout?** Is there one email layout/template I should add this to once, so it appears
     consistently — or are emails built ad hoc per type?
   - **What actually sends the mail, and what's the template format?** (e.g. SendGrid / Postmark /
     SES / Resend; and raw HTML / Handlebars / MJML / React Email / something else.) This drives the
     whole implementation, so confirm it before building.
   - **Plain-text part:** do these emails include a `text/plain` alternative I need to update too?
   - **Brand color:** the button below defaults to `#2563eb` (the portal's primary blue). Confirm the
     correct brand hex for customer-facing email, or tell me to keep this.

Only build once I've answered. If something is ambiguous after you've read the code, ask rather than guess.

---

## The exact button to use (email-safe — do not redesign it)

This is a "bulletproof button": it renders as a real button in Gmail, Apple Mail, etc., **and** has a
VML fallback so it also renders as a solid button in Outlook (Windows). Use it as-is; only swap the
color/label if I tell you to.

**Review link (already embedded below):** `https://g.page/r/CfcLJB_RwxCREBM/review`

```html
<!-- Google review button — email-safe (bulletproof, Outlook-friendly). -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:16px auto;">
  <tr>
    <td align="center" style="border-radius:6px;background:#2563eb;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="https://g.page/r/CfcLJB_RwxCREBM/review"
        style="height:48px;v-text-anchor:middle;width:280px;" arcsize="13%"
        strokecolor="#2563eb" fillcolor="#2563eb">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
          &#9733; Leave us a Google review
        </center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="https://g.page/r/CfcLJB_RwxCREBM/review" target="_blank"
        style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;background:#2563eb;">
        &#9733; Leave us a Google review
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>
```

Optional one-line lead-in you can place above the button:

```html
<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#475569;text-align:center;">
  Happy with how we did? A quick Google review means a lot to our team.
</p>
```

**Plain-text version** (for the `text/plain` part, if these emails have one):

```
Happy with how we did? A quick Google review means a lot to our team:
https://g.page/r/CfcLJB_RwxCREBM/review
```

---

## Email-HTML rules (non-negotiable — this is where buttons break)

- **Keep the `<!--[if mso]>` / `<![endif]-->` blocks.** That VML `roundrect` is what makes the button
  solid in Outlook. Removing it leaves Outlook users with a plain blue text link.
- **Inline styles only.** No `<style>` blocks or external CSS for the button — many clients strip them.
- Layout with **tables**, not flexbox/grid.
- Don't rely on background images, web fonts, or JavaScript.
- Keep the link **exactly** as `https://g.page/r/CfcLJB_RwxCREBM/review` — don't wrap, shorten, or
  URL-encode it differently, or click tracking/rewriting may break the deep link.
- The `&#9733;` is a ★ star glyph. It's safe in UTF-8 email; drop it if I ask for a plainer look.
- If a shared layout exists, add the button there **once** behind the optional flag — don't paste it
  into each template separately.

---

## Definition of done

- [ ] Button is included **only when the sender opts in** (per the control we agree on), and emails are
      unchanged when it's off.
- [ ] Renders as a solid, clickable button in **Gmail (web + mobile)** and **Outlook (Windows)** — send
      real test emails to both and confirm. This is the acceptance test; don't skip Outlook.
- [ ] Clicking it opens the Google review screen at `https://g.page/r/CfcLJB_RwxCREBM/review`.
- [ ] Plain-text alternative includes the review URL (if the email has a text part).
- [ ] No layout shift or broken spacing in the surrounding email.
- [ ] When you open a PR, note in the description that you tested a real send to Gmail and Outlook.

---

*Source: National Sports portal team. Review link is the live Google Business Profile review deep-link.*
