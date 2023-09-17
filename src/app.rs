use crate::error_template::{AppError, ErrorTemplate};
use leptos::*;
use leptos_meta::*;
use leptos_router::*;
use serde::{Serialize, Deserialize};

#[component]
pub fn App(cx: Scope) -> impl IntoView {
    // Provides context that manages stylesheets, titles, meta tags, etc.
    provide_meta_context(cx);

    view! {
        cx,

        // injects a stylesheet into the document <head>
        // id=leptos means cargo-leptos will hot-reload this stylesheet
        <Stylesheet id="leptos" href="/pkg/port-forwarding-tool.css"/>

        // sets the document title
        <Title text="Welcome to Leptos"/>

        // content for this welcome page
        <Router fallback=|cx| {
            let mut outside_errors = Errors::default();
            outside_errors.insert_with_default_key(AppError::NotFound);
            view! { cx,
                <ErrorTemplate outside_errors/>
            }
            .into_view(cx)
        }>
            <main>
                <Routes>
                    <Route path="" view=|cx| view! { cx, <HomePage/> }/>
                </Routes>
            </main>
        </Router>
    }
}


#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Thing {
    description: String,
    source_port: u16,
    target_port: u16,
    target_ip_address: String,
    enabled: bool,
}

#[server(Things)]
pub async fn get_things() -> Result<Vec<Thing>, ServerFnError> {
    std::thread::sleep(std::time::Duration::from_millis(1200));

    let mut things = Vec::new();
    things.push(Thing {
        description: "please".to_owned(),
        source_port: 25565,
        target_port: 25565,
        target_ip_address: "192.168.1.123".to_owned(),
        enabled: true
    });
    Ok(things)
}

/// Renders the home page of your application.
#[component]
fn HomePage(cx: Scope) -> impl IntoView {
    let things = create_resource(
        cx,
        move || true,
        move |_| get_things()
    );

    view! { cx,
        <h2>"Your port forwards"</h2>
        <Transition fallback=move || view! {cx, <p>"Loading.."</p>}>
            {
                move || {
                    let the_things = {
                        move || {
                            things.read(cx)
                            .map(move |things| match things {
                                Err(e) => {
                                    view! { cx, <pre class="error">"Server Error: " {e.to_string()}</pre>}.into_view(cx)
                                },
                                Ok(things) => {
                                    if things.is_empty() {
                                        view! { cx, <p>"no things"</p> }.into_view(cx)
                                    } else {
                                        let list = things
                                        .into_iter()
                                        .map(move |thing| {
                                            view! {
                                                cx,
                                                <li>:{thing.source_port} --> {thing.target_ip_address}:{thing.target_port}</li>
                                            }
                                        })
                                        .collect_view(cx);

                                        view! {
                                            cx,
                                            <ul>
                                                {list}
                                            </ul>
                                        }.into_view(cx)
                                    }
                                }
                            }).collect_view(cx)
                        }
                    };

                    view! {
                        cx,
                        <div>
                            {the_things}
                        </div>
                    }
                }
            }
        </Transition>
    }
}
