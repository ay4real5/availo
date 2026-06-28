const res = await fetch("http://localhost:4000/api/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "demo@example.com" }),
});
const data = await res.json();
console.log(JSON.stringify(data));
