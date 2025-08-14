import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button, Form, InputGroup } from "react-bootstrap";
import { faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";

const AssetListHeader = ()=>{
    return(
        <>
            <InputGroup className="mb-3">
                <Form.Control placeholder="Search..."/>
                <Button variant="outline-secondary">
                    <FontAwesomeIcon icon={faMagnifyingGlass} />
                </Button>
            </InputGroup>
        </>
    );
}

export default AssetListHeader;